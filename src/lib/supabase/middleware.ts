import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from './config';
import { getSupabaseServerConfig } from '@/lib/supabase/env';
import { getRoyalAuthCookieOptions, hardenAuthCookie } from '@/lib/supabase/session-cookies';

const EXAM_WINDOW_ACCESS_HEADER = 'x-royal-window-access';

export async function updateSession(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const { url, publishableKey } = getSupabaseServerConfig();

  if (!url || !publishableKey || !isSupabaseConfigured()) {
    return response;
  }

  const supabase = createServerClient(url, publishableKey, {
    cookieOptions: getRoyalAuthCookieOptions(),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, cacheHeaders) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: requestHeaders } });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, hardenAuthCookie(options));
        });
        Object.entries(cacheHeaders).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  const pathname = request.nextUrl.pathname;

  function forwardExamSession(accessToken: string | null) {
    if (accessToken) {
      requestHeaders.set('authorization', `Bearer ${accessToken}`);
    } else {
      requestHeaders.delete('authorization');
    }

    const pendingCookies = response.cookies.getAll();
    const pendingCacheHeaders = ['cache-control', 'expires', 'pragma']
      .map((name) => [name, response.headers.get(name)] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1]));

    response = NextResponse.next({ request: { headers: requestHeaders } });
    pendingCookies.forEach((cookie) => response.cookies.set(cookie));
    pendingCacheHeaders.forEach(([name, value]) => response.headers.set(name, value));
    return response;
  }

  // A signed exam-window capability is verified again inside /api/exam and is
  // bound to the cryptographically verified user/session there. For this narrow
  // read-only path, only extract the cookie-backed access token here instead of
  // doing a remote user lookup on every prefetch. getSession() is not trusted for
  // authorization; the route verifies the JWT and the signed capability. If that
  // capability is invalid or expired, the route performs authoritative validation
  // before falling back to the regular backend path.
  if (pathname === '/api/exam' && request.headers.get(EXAM_WINDOW_ACCESS_HEADER)) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return forwardExamSession(session?.access_token || null);
  }

  // Validate/refresh the cookie-backed session before using it for authorization.
  await supabase.auth.getClaims();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  function withSessionState(target: NextResponse) {
    response.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
    for (const headerName of ['cache-control', 'expires', 'pragma']) {
      const value = response.headers.get(headerName);
      if (value) target.headers.set(headerName, value);
    }
    return target;
  }

  // The browser never receives or supplies the access token. For the existing exam
  // gateway contract, middleware injects the validated cookie session server-side.
  // Any caller-supplied Authorization header is overwritten or removed.
  if (pathname === '/api/exam') {
    // Admin-issued temporary passwords must not retain exam/API access. getUser()
    // reads the current Auth user, so this remains authoritative even when an older
    // access-token claim has not yet refreshed after the administrative reset.
    if (user?.app_metadata?.must_change_password === true) {
      const blocked = NextResponse.json(
        {
          error: {
            code: 'PASSWORD_CHANGE_REQUIRED',
            message: 'Change your password before continuing.',
          },
        },
        { status: 403 },
      );
      blocked.headers.set('cache-control', 'no-store');
      return withSessionState(blocked);
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    return forwardExamSession(user && session?.access_token ? session.access_token : null);
  }

  const isAuthRoute = pathname.startsWith('/login') || pathname.startsWith('/register');
  const isInactiveRoute = pathname.startsWith('/inactive');
  const isPasswordChangeRoute = pathname.startsWith('/change-password');
  const bankHomeMatch = pathname.match(/^\/bank\/(\d+)\/?$/);
  const isProtectedRoute =
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/bank') ||
    pathname.startsWith('/pathway') ||
    pathname.startsWith('/exam') ||
    pathname.startsWith('/upgrade') ||
    pathname.startsWith('/partner') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/support') ||
    isPasswordChangeRoute;

  function redirectWithSession(urlToUse: URL) {
    return withSessionState(NextResponse.redirect(urlToUse));
  }

  if (!user && isProtectedRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.searchParams.set('redirect', pathname);
    return redirectWithSession(redirectUrl);
  }

  if (!user && isInactiveRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.search = '';
    return redirectWithSession(redirectUrl);
  }

  // Exact bank-home requests already execute get_question_bank_performance() in the
  // page. That RPC is the authoritative bank-access boundary and internally checks
  // active-account state via can_access_question_bank(). Avoid a second sequential
  // is_active_user() PostgREST round-trip for the normal path. Keep the fresh Auth
  // user lookup above so admin-issued must_change_password remains immediate. If a
  // forced-password user hits the bank home, preserve the previous inactive-before-
  // password-change precedence with the active lookup only for that exceptional path.
  if (user && bankHomeMatch) {
    const mustChangePassword = user.app_metadata?.must_change_password === true;
    if (mustChangePassword) {
      const { data: isActive, error: activeError } = await supabase.rpc('is_active_user');
      const accountIsActive = !activeError && isActive === true;

      if (!accountIsActive) {
        const redirectUrl = request.nextUrl.clone();
        redirectUrl.pathname = '/inactive';
        redirectUrl.search = '';
        return redirectWithSession(redirectUrl);
      }

      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/change-password';
      redirectUrl.search = '';
      return redirectWithSession(redirectUrl);
    }

    return response;
  }

  if (user && (isProtectedRoute || isAuthRoute || isInactiveRoute)) {
    const { data: isActive, error: activeError } = await supabase.rpc('is_active_user');
    const accountIsActive = !activeError && isActive === true;

    if (!accountIsActive && !isInactiveRoute) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/inactive';
      redirectUrl.search = '';
      return redirectWithSession(redirectUrl);
    }

    const mustChangePassword = user.app_metadata?.must_change_password === true;
    if (accountIsActive && mustChangePassword && !isPasswordChangeRoute) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/change-password';
      redirectUrl.search = '';
      return redirectWithSession(redirectUrl);
    }

    if (accountIsActive && (isAuthRoute || isInactiveRoute)) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = mustChangePassword ? '/change-password' : '/dashboard';
      redirectUrl.search = '';
      return redirectWithSession(redirectUrl);
    }
  }

  return response;
}

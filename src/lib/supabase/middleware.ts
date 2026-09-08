import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from './config';
import { getSupabaseServerConfig } from '@/lib/supabase/env';
import { getRoyalAuthCookieOptions, hardenAuthCookie } from '@/lib/supabase/session-cookies';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
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
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, hardenAuthCookie(options));
        });
        Object.entries(cacheHeaders).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Validate/refresh the cookie-backed session before using it for authorization.
  await supabase.auth.getClaims();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isAuthRoute = pathname.startsWith('/login') || pathname.startsWith('/register');
  const isInactiveRoute = pathname.startsWith('/inactive');
  const isProtectedRoute =
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/bank') ||
    pathname.startsWith('/pathway') ||
    pathname.startsWith('/exam') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/support');

  function redirectWithSession(urlToUse: URL) {
    const redirectResponse = NextResponse.redirect(urlToUse);
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    for (const headerName of ['cache-control', 'expires', 'pragma']) {
      const value = response.headers.get(headerName);
      if (value) redirectResponse.headers.set(headerName, value);
    }
    return redirectResponse;
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

  if (user && (isProtectedRoute || isAuthRoute || isInactiveRoute)) {
    const { data: isActive, error: activeError } = await supabase.rpc('is_active_user');
    const accountIsActive = !activeError && isActive === true;

    if (!accountIsActive && !isInactiveRoute) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/inactive';
      redirectUrl.search = '';
      return redirectWithSession(redirectUrl);
    }

    if (accountIsActive && (isAuthRoute || isInactiveRoute)) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/dashboard';
      redirectUrl.search = '';
      return redirectWithSession(redirectUrl);
    }

    const bankHomeMatch = pathname.match(/^\/bank\/(\d+)\/?$/);
    if (accountIsActive && bankHomeMatch) {
      const bankId = Number(bankHomeMatch[1]);
      const { data: canAccessBank, error: accessError } = await supabase.rpc(
        'can_access_question_bank',
        { p_bank_id: bankId }
      );

      if (accessError || canAccessBank !== true) {
        const redirectUrl = request.nextUrl.clone();
        redirectUrl.pathname = '/dashboard';
        redirectUrl.search = '';
        redirectUrl.searchParams.set('access', 'denied');
        return redirectWithSession(redirectUrl);
      }
    }
  }

  return response;
}

import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from './config';
import { getSupabaseServerConfig } from '@/lib/supabase/env';
import { getRoyalAuthCookieOptions, hardenAuthCookie } from '@/lib/supabase/session-cookies';
import {
  isInProductionEdgeRollout,
  jwtSubject,
  productionEdgeCutoverEnabled,
} from '@/lib/exam-edge-rollout';

const EDGE_MIGRATION_BRANCH = 'architecture/cloudflare-exam-v2';
const PRODUCTION_SMOKE_CANARY_PARAM = '__royal_edge_canary';
const PRODUCTION_SMOKE_CANARY_VALUE = 'smoke';
const PRODUCTION_ROLLOUT_CANARY_VALUE = 'rollout';
const INTERNAL_CANARY_HEADER = 'x-royal-edge-canary';

type EdgeCanaryMode =
  | typeof PRODUCTION_SMOKE_CANARY_VALUE
  | typeof PRODUCTION_ROLLOUT_CANARY_VALUE
  | null;

export async function updateSession(request: NextRequest) {
  const middlewareStart = performance.now();
  const requestHeaders = new Headers(request.headers);
  // Never trust diagnostic/internal headers supplied by the caller.
  requestHeaders.delete('x-royal-internal-middleware-ms');
  requestHeaders.delete(INTERNAL_CANARY_HEADER);
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
  const routeExamToEdge =
    productionEdgeCutoverEnabled() ||
    (process.env.VERCEL_ENV === 'preview' &&
      process.env.VERCEL_GIT_COMMIT_REF === EDGE_MIGRATION_BRANCH) ||
    process.env.ROYAL_EXAM_EDGE_ENABLED === 'true';
  const productionSmokeCanary =
    process.env.VERCEL_ENV === 'production' &&
    pathname === '/api/exam' &&
    request.nextUrl.searchParams.get(PRODUCTION_SMOKE_CANARY_PARAM) === PRODUCTION_SMOKE_CANARY_VALUE;

  function forwardExamSession(
    accessToken: string | null,
    rewriteToEdge = false,
    canaryMode: EdgeCanaryMode = null,
  ) {
    if (process.env.ROYAL_GATEWAY_TIMING_ENABLED === 'true') {
      requestHeaders.set('x-royal-internal-middleware-ms', (performance.now() - middlewareStart).toFixed(1));
    }
    if (accessToken) {
      requestHeaders.set('authorization', `Bearer ${accessToken}`);
    } else {
      requestHeaders.delete('authorization');
    }
    if (canaryMode) {
      requestHeaders.set(INTERNAL_CANARY_HEADER, canaryMode);
    } else {
      requestHeaders.delete(INTERNAL_CANARY_HEADER);
    }

    const pendingCookies = response.cookies.getAll();
    const pendingCacheHeaders = ['cache-control', 'expires', 'pragma']
      .map((name) => [name, response.headers.get(name)] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1]));

    response = rewriteToEdge
      ? NextResponse.rewrite(new URL('/api/exam-edge', request.url), {
          request: { headers: requestHeaders },
        })
      : NextResponse.next({ request: { headers: requestHeaders } });
    pendingCookies.forEach((cookie) => response.cookies.set(cookie));
    pendingCacheHeaders.forEach(([name, value]) => response.headers.set(name, value));
    return response;
  }

  // Deep Dive uses the same cookie-backed Supabase session as the exam client.
  // Forward the refreshed access token as a bearer header so API routes do not depend
  // on a stale pre-refresh cookie snapshot inside the same request.
  if (
    pathname === '/api/deep-dive' ||
    pathname === '/api/deep-dive/admin/entitlement'
  ) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return forwardExamSession(session?.access_token || null);
  }

  // /api/exam has its own fail-closed authentication boundary. The route verifies the
  // ES256 bearer JWT locally against pinned public keys, validates issuer/audience/role,
  // and every protected PostgREST RPC is then gated by api_hooks.royal_exam_pre_request,
  // which checks the live auth.users row (existence, ban status, must_change_password)
  // before execution. Therefore middleware only needs to extract/refresh the server-side
  // cookie session and forward its access token; repeating getClaims()+getUser() here
  // adds remote Auth round-trips without adding an independent authorization boundary.
  // Caller-supplied Authorization remains overwritten/removed for normal traffic.
  // The isolated Production smoke canary additionally accepts a bearer token so a
  // temporary @load.invalid test account can exercise the real /api/exam route.
  // Production now routes all normal exam traffic through Cloudflare Edge by default.
  // Set ROYAL_EXAM_EDGE_FORCE_LEGACY=true only for an emergency rollback. The historical
  // deterministic rollout cohort remains available for non-cutover/canary operation.
  // /api/exam-edge revalidates the JWT before forwarding to Cloudflare.
  if (pathname === '/api/exam') {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const sessionToken = session?.access_token || null;
    const sessionUserId = jwtSubject(sessionToken);
    const productionRolloutCanary =
      process.env.VERCEL_ENV === 'production' &&
      process.env.ROYAL_EXAM_EDGE_FORCE_LEGACY !== 'true' &&
      !productionSmokeCanary &&
      !routeExamToEdge &&
      Boolean(sessionUserId && isInProductionEdgeRollout(sessionUserId));

    const callerAuthorization = productionSmokeCanary ? request.headers.get('authorization') || '' : '';
    const canaryBearer = callerAuthorization.startsWith('Bearer ')
      ? callerAuthorization.slice(7).trim() || null
      : null;
    const canaryMode: EdgeCanaryMode = productionSmokeCanary
      ? PRODUCTION_SMOKE_CANARY_VALUE
      : productionRolloutCanary
        ? PRODUCTION_ROLLOUT_CANARY_VALUE
        : null;

    return forwardExamSession(
      canaryBearer || sessionToken,
      routeExamToEdge || productionSmokeCanary || productionRolloutCanary,
      canaryMode,
    );
  }

  // Validate/refresh the cookie-backed session before using it for authorization on
  // regular application routes. These routes keep their existing authoritative checks.
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

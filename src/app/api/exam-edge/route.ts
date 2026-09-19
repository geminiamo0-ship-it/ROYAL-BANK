import { createClient } from '@/lib/supabase/server';
import {
  isInProductionEdgeRollout,
  productionEdgeCutoverEnabled,
} from '@/lib/exam-edge-rollout';

export const runtime = 'nodejs';
export const preferredRegion = 'dub1';
export const maxDuration = 20;

const MAX_BODY_BYTES = 32 * 1024;
const EDGE_TIMEOUT_MS = 18_000;
const EDGE_HEALTH_TIMEOUT_MS = 5_000;
const MIGRATION_BRANCH = 'architecture/cloudflare-exam-v2';
const DEV_EDGE_URL = 'https://royal-bank-v2-exam.geminiamo0.workers.dev';
const PROD_EDGE_URL = 'https://royal-bank-exam-production.geminiamo0.workers.dev';
const INTERNAL_CANARY_HEADER = 'x-royal-edge-canary';
const PRODUCTION_SMOKE_CANARY_VALUE = 'smoke';
const PRODUCTION_ROLLOUT_CANARY_VALUE = 'rollout';

type EdgeCanaryMode =
  | typeof PRODUCTION_SMOKE_CANARY_VALUE
  | typeof PRODUCTION_ROLLOUT_CANARY_VALUE
  | null;

type EdgeRouteMode =
  | { mode: 'legacy' }
  | { mode: 'misconfigured' }
  | { mode: 'edge'; url: URL; canaryMode: EdgeCanaryMode };

function jsonError(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    {
      status,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
        'x-royal-proxy': 'cloudflare-edge',
      },
    },
  );
}

function edgeRouteMode(request: Request): EdgeRouteMode {
  const migrationPreview =
    process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_GIT_COMMIT_REF === MIGRATION_BRANCH;
  const productionCutover = productionEdgeCutoverEnabled();
  const explicitlyEnabled = productionCutover || process.env.ROYAL_EXAM_EDGE_ENABLED === 'true';
  const canaryHeader = process.env.VERCEL_ENV === 'production'
    ? request.headers.get(INTERNAL_CANARY_HEADER)
    : null;
  const smokeCanary = canaryHeader === PRODUCTION_SMOKE_CANARY_VALUE;
  const rolloutCanary = canaryHeader === PRODUCTION_ROLLOUT_CANARY_VALUE;

  if (!migrationPreview && !explicitlyEnabled && !smokeCanary && !rolloutCanary) {
    return { mode: 'legacy' };
  }

  const canaryMode: EdgeCanaryMode = smokeCanary
    ? PRODUCTION_SMOKE_CANARY_VALUE
    : rolloutCanary
      ? PRODUCTION_ROLLOUT_CANARY_VALUE
      : null;
  const fallbackUrl = migrationPreview
    ? DEV_EDGE_URL
    : productionCutover || canaryMode
      ? PROD_EDGE_URL
      : '';
  const raw = process.env.ROYAL_EXAM_EDGE_URL?.trim() || fallbackUrl;
  if (!raw) return { mode: 'misconfigured' };

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return { mode: 'misconfigured' };
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    parsed.search = '';
    parsed.hash = '';
    return { mode: 'edge', url: parsed, canaryMode };
  } catch {
    return { mode: 'misconfigured' };
  }
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice(7).trim();
  return token || null;
}

function timedOut(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

export async function GET(request: Request): Promise<Response> {
  const routing = edgeRouteMode(request);

  if (routing.mode === 'legacy') {
    return Response.json(
      { ok: true, mode: 'legacy' },
      {
        headers: {
          'cache-control': 'no-store',
          'x-royal-proxy': 'legacy-fallback',
        },
      },
    );
  }
  if (routing.mode === 'misconfigured') {
    return jsonError(503, 'EDGE_EXAM_NOT_CONFIGURED', 'Edge exam gateway is not configured.');
  }

  const healthUrl = new URL(routing.url.toString());
  healthUrl.pathname = `${healthUrl.pathname}/health`.replace(/\/+/g, '/');

  let upstream: Response;
  try {
    upstream = await fetch(healthUrl, {
      method: 'GET',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(EDGE_HEALTH_TIMEOUT_MS),
    });
  } catch (error) {
    return timedOut(error)
      ? jsonError(504, 'EDGE_HEALTH_TIMEOUT', 'Edge exam gateway health check timed out.')
      : jsonError(502, 'EDGE_HEALTH_UNAVAILABLE', 'Edge exam gateway health check failed.');
  }

  const responseBody = await upstream.text();
  const headers = new Headers({
    'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-royal-proxy': 'cloudflare-edge',
  });
  const gateway = upstream.headers.get('x-royal-gateway');
  if (gateway) headers.set('x-royal-gateway', gateway);

  return new Response(responseBody, { status: upstream.status, headers });
}

export async function POST(request: Request): Promise<Response> {
  const requestStarted = performance.now();
  let authClaimsMs = 0;
  let authFreshUserMs = 0;
  let upstreamMs = 0;
  const requestId = crypto.randomUUID();
  const routing = edgeRouteMode(request);

  if (routing.mode === 'legacy') {
    return Response.redirect(new URL('/api/exam', request.url), 307);
  }
  if (routing.mode === 'misconfigured') {
    const response = jsonError(503, 'EDGE_EXAM_NOT_CONFIGURED', 'Edge exam gateway is not configured.');
    response.headers.set('x-royal-request-id', requestId);
    return response;
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    const response = jsonError(413, 'REQUEST_TOO_LARGE', 'Request is too large.');
    response.headers.set('x-royal-request-id', requestId);
    return response;
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    const response = jsonError(400, 'INVALID_REQUEST', 'Invalid request body.');
    response.headers.set('x-royal-request-id', requestId);
    return response;
  }

  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    const response = jsonError(413, 'REQUEST_TOO_LARGE', 'Request is too large.');
    response.headers.set('x-royal-request-id', requestId);
    return response;
  }

  let action: string | null = null;
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const candidate = (parsed as Record<string, unknown>).action;
      if (typeof candidate === 'string') action = candidate;
    }
  } catch {
    // The Worker owns full request validation and returns the canonical 400.
  }

  const supabase = await createClient();
  const callerToken = bearerToken(request);
  let accessToken = callerToken;

  if (!accessToken) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    accessToken = session?.access_token || null;
  }

  if (!accessToken) {
    const response = jsonError(401, 'AUTH_REQUIRED', 'Authentication required.');
    response.headers.set('x-royal-request-id', requestId);
    return response;
  }

  // Verify the signed access token locally (cached JWKS for asymmetric projects)
  // instead of making a network getUser() call on every exam action. Cloudflare
  // independently verifies the same JWT again before touching the user's DO.
  const authClaimsStarted = performance.now();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(accessToken);
  authClaimsMs = performance.now() - authClaimsStarted;
  const claims = claimsData?.claims as Record<string, unknown> | undefined;
  const userId = typeof claims?.sub === 'string' ? claims.sub : '';
  const userRole = typeof claims?.role === 'string' ? claims.role : '';
  const userEmail = typeof claims?.email === 'string' ? claims.email : '';
  const appMetadata =
    claims?.app_metadata && typeof claims.app_metadata === 'object' && !Array.isArray(claims.app_metadata)
      ? claims.app_metadata as Record<string, unknown>
      : null;

  if (claimsError || !userId || userRole !== 'authenticated') {
    const response = jsonError(401, 'INVALID_AUTH_TOKEN', 'Authentication token is invalid.');
    response.headers.set('x-royal-request-id', requestId);
    return response;
  }

  if (routing.canaryMode === PRODUCTION_SMOKE_CANARY_VALUE && !userEmail.endsWith('@load.invalid')) {
    const response = jsonError(403, 'EDGE_CANARY_NOT_ALLOWED', 'This account is not enabled for the Edge canary.');
    response.headers.set('x-royal-request-id', requestId);
    return response;
  }
  if (
    routing.canaryMode === PRODUCTION_ROLLOUT_CANARY_VALUE &&
    !isInProductionEdgeRollout(userId)
  ) {
    const response = jsonError(403, 'EDGE_ROLLOUT_NOT_ALLOWED', 'This account is not in the Edge rollout cohort.');
    response.headers.set('x-royal-request-id', requestId);
    return response;
  }

  // Prepare is the security/entitlement boundary for a new exam. Refresh the
  // user record here so an admin-issued password-change requirement is observed
  // before a new session can be prepared. Hot exam actions use the verified JWT
  // and the already-authorized per-user Durable Object session.
  if (action === 'prepare') {
    const authFreshUserStarted = performance.now();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(accessToken);
    authFreshUserMs = performance.now() - authFreshUserStarted;
    if (userError || !user || user.id !== userId) {
      const response = jsonError(401, 'INVALID_AUTH_TOKEN', 'Authentication token is invalid.');
      response.headers.set('x-royal-request-id', requestId);
      return response;
    }
    if (user.app_metadata?.must_change_password === true) {
      const response = jsonError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your password before continuing.');
      response.headers.set('x-royal-request-id', requestId);
      return response;
    }
  } else if (appMetadata?.must_change_password === true) {
    const response = jsonError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your password before continuing.');
    response.headers.set('x-royal-request-id', requestId);
    return response;
  }

  const upstreamUrl = new URL(routing.url.toString());
  upstreamUrl.pathname = `${upstreamUrl.pathname}/exam`.replace(/\/+/g, '/');

  let upstream: Response;
  const upstreamStarted = performance.now();
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: rawBody,
      signal: AbortSignal.timeout(EDGE_TIMEOUT_MS),
    });
  } catch (error) {
    const response = timedOut(error)
      ? jsonError(504, 'EDGE_EXAM_TIMEOUT', 'Exam request took too long to complete.')
      : jsonError(502, 'EDGE_EXAM_UNAVAILABLE', 'Exam service is temporarily unavailable.');
    response.headers.set('x-royal-request-id', requestId);
    return response;
  }

  const responseBody = await upstream.text();
  upstreamMs = performance.now() - upstreamStarted;
  const headers = new Headers({
    'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-royal-request-id': requestId,
    'x-royal-proxy': 'cloudflare-edge',
  });

  for (const headerName of ['server-timing', 'retry-after', 'x-royal-gateway', 'x-royal-timing-version']) {
    const value = upstream.headers.get(headerName);
    if (value) headers.set(headerName, value);
  }

  const upstreamTiming = headers.get('server-timing');
  const proxyTiming = [
    `vercel_auth_claims;dur=${authClaimsMs.toFixed(2)}`,
    `vercel_auth_fresh_user;dur=${authFreshUserMs.toFixed(2)}`,
    `vercel_upstream;dur=${upstreamMs.toFixed(2)}`,
    `vercel_total;dur=${(performance.now() - requestStarted).toFixed(2)}`,
  ].join(', ');
  headers.set('server-timing', upstreamTiming ? `${upstreamTiming}, ${proxyTiming}` : proxyTiming);
  headers.set('x-royal-proxy-timing-version', '2');

  return new Response(responseBody, {
    status: upstream.status,
    headers,
  });
}

import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const preferredRegion = 'dub1';
export const maxDuration = 20;

const MAX_BODY_BYTES = 32 * 1024;
const EDGE_TIMEOUT_MS = 18_000;
const EDGE_HEALTH_TIMEOUT_MS = 5_000;
const MIGRATION_BRANCH = 'architecture/cloudflare-exam-v2';
const DEV_EDGE_URL = 'https://royal-bank-v2-exam.geminiamo0.workers.dev';

type EdgeRouteMode =
  | { mode: 'legacy' }
  | { mode: 'misconfigured' }
  | { mode: 'edge'; url: URL };

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

function edgeRouteMode(): EdgeRouteMode {
  const migrationPreview =
    process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_GIT_COMMIT_REF === MIGRATION_BRANCH;
  const explicitlyEnabled = process.env.ROYAL_EXAM_EDGE_ENABLED === 'true';

  if (!migrationPreview && !explicitlyEnabled) return { mode: 'legacy' };

  const raw = process.env.ROYAL_EXAM_EDGE_URL?.trim() || (migrationPreview ? DEV_EDGE_URL : '');
  if (!raw) return { mode: 'misconfigured' };

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return { mode: 'misconfigured' };
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    parsed.search = '';
    parsed.hash = '';
    return { mode: 'edge', url: parsed };
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

export async function GET(): Promise<Response> {
  const routing = edgeRouteMode();

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
  const requestId = crypto.randomUUID();
  const routing = edgeRouteMode();

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

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(accessToken);
  if (userError || !user) {
    const response = jsonError(401, 'INVALID_AUTH_TOKEN', 'Authentication token is invalid.');
    response.headers.set('x-royal-request-id', requestId);
    return response;
  }
  if (user.app_metadata?.must_change_password === true) {
    const response = jsonError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your password before continuing.');
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

  const upstreamUrl = new URL(routing.url.toString());
  upstreamUrl.pathname = `${upstreamUrl.pathname}/exam`.replace(/\/+/g, '/');

  let upstream: Response;
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

  return new Response(responseBody, {
    status: upstream.status,
    headers,
  });
}

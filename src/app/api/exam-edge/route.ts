import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const preferredRegion = 'dub1';
export const maxDuration = 20;

const MAX_BODY_BYTES = 32 * 1024;
const EDGE_TIMEOUT_MS = 18_000;

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

function configuredEdgeUrl(): URL | null {
  if (process.env.ROYAL_EXAM_EDGE_ENABLED !== 'true') return null;
  const raw = process.env.ROYAL_EXAM_EDGE_URL?.trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return null;
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    parsed.search = '';
    parsed.hash = '';
    return parsed;
  } catch {
    return null;
  }
}

function timedOut(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

export async function POST(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const edgeUrl = configuredEdgeUrl();
  if (!edgeUrl) {
    const response = jsonError(503, 'EDGE_EXAM_DISABLED', 'Edge exam gateway is not enabled.');
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
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const accessToken = session?.access_token;
  if (!accessToken) {
    const response = jsonError(401, 'AUTH_REQUIRED', 'Authentication required.');
    response.headers.set('x-royal-request-id', requestId);
    return response;
  }

  if (session.user.app_metadata?.must_change_password === true) {
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

  const upstreamUrl = new URL(edgeUrl.toString());
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

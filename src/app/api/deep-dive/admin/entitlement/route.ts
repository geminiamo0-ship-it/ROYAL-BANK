import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const preferredRegion = 'dub1';
export const maxDuration = 30;

const MAX_BODY_BYTES = 8 * 1024;
const EDGE_TIMEOUT_MS = 20_000;
const DEV_EDGE_URL = 'https://royal-bank-v2-exam.geminiamo0.workers.dev';
const PROD_EDGE_URL = 'https://royal-bank-exam-production.geminiamo0.workers.dev';

function jsonError(status: number, code: string, message: string) {
  return Response.json(
    { error: { code, message } },
    {
      status,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
      },
    },
  );
}

function edgeBaseUrl(): URL | null {
  const fallback = process.env.VERCEL_ENV === 'production' ? PROD_EDGE_URL : DEV_EDGE_URL;
  const raw =
    process.env.ROYAL_DEEP_DIVE_EDGE_URL?.trim()
    || process.env.ROYAL_EXAM_EDGE_URL?.trim()
    || fallback;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    url.pathname = url.pathname.replace(/\/+$/, '');
    url.search = '';
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function timedOut(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice(7).trim();
  return token || null;
}

export async function POST(request: Request): Promise<Response> {
  const length = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return jsonError(413, 'REQUEST_TOO_LARGE', 'Request is too large.');
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    return jsonError(400, 'INVALID_REQUEST', 'Invalid request.');
  }
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    return jsonError(413, 'REQUEST_TOO_LARGE', 'Request is too large.');
  }

  const supabase = await createClient();
  let accessToken = bearerToken(request);
  if (!accessToken) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    accessToken = session?.access_token || null;
  }
  if (!accessToken) {
    return jsonError(401, 'AUTH_REQUIRED', 'Authentication required.');
  }

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(accessToken);
  const claims = claimsData?.claims as Record<string, unknown> | undefined;
  if (claimsError || claims?.role !== 'authenticated' || typeof claims?.sub !== 'string') {
    return jsonError(401, 'INVALID_AUTH_TOKEN', 'Authentication token is invalid.');
  }

  const base = edgeBaseUrl();
  if (!base) {
    return jsonError(503, 'DEEP_DIVE_NOT_CONFIGURED', 'Deep Dive is not configured.');
  }
  const upstreamUrl = new URL(base.toString());
  upstreamUrl.pathname = `${upstreamUrl.pathname}/deep-dive/admin/entitlement`.replace(/\/+/g, '/');

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
      body,
      signal: AbortSignal.timeout(EDGE_TIMEOUT_MS),
    });
  } catch (error) {
    return timedOut(error)
      ? jsonError(504, 'DEEP_DIVE_ADMIN_TIMEOUT', 'AI allowance request timed out.')
      : jsonError(502, 'DEEP_DIVE_ADMIN_UNAVAILABLE', 'AI allowance service is temporarily unavailable.');
  }

  const raw = await upstream.text();
  return new Response(raw, {
    status: upstream.status,
    headers: {
      'cache-control': 'no-store',
      'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      'x-royal-deep-dive-admin-proxy': 'cloudflare',
    },
  });
}

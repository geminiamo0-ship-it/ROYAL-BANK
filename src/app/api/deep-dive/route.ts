import { createClient } from '@/lib/supabase/server';
import { getRoyalSupportTelegramUrl } from '@/lib/royal-support';

export const runtime = 'nodejs';
export const preferredRegion = 'dub1';
export const maxDuration = 60;

const MAX_BODY_BYTES = 8 * 1024;
const EDGE_TIMEOUT_MS = 55_000;
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
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
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

  const base = edgeBaseUrl();
  if (!base) {
    return jsonError(503, 'DEEP_DIVE_NOT_CONFIGURED', 'Deep Dive is not configured.');
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

  const upstreamUrl = new URL(base.toString());
  upstreamUrl.pathname = `${upstreamUrl.pathname}/deep-dive`.replace(/\/+/g, '/');

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
      ? jsonError(504, 'DEEP_DIVE_TIMEOUT', 'Deep Dive took too long. Please try again.')
      : jsonError(502, 'DEEP_DIVE_UNAVAILABLE', 'Deep Dive is temporarily unavailable.');
  }

  const raw = await upstream.text();
  const contentType = upstream.headers.get('content-type') || 'application/json; charset=utf-8';

  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const errorCode =
        parsed.error && typeof parsed.error === 'object' && !Array.isArray(parsed.error)
          ? (parsed.error as { code?: unknown }).code
          : null;
      if (errorCode === 'DEEP_DIVE_DAILY_LIMIT') {
        parsed.supportUrl = getRoyalSupportTelegramUrl();
      }
      return Response.json(parsed, {
        status: upstream.status,
        headers: {
          'cache-control': 'no-store',
          'x-royal-deep-dive-proxy': 'cloudflare',
        },
      });
    } catch {
      // Preserve the upstream body below if it is not valid JSON.
    }
  }

  return new Response(raw, {
    status: upstream.status,
    headers: {
      'cache-control': 'no-store',
      'content-type': contentType,
      'x-royal-deep-dive-proxy': 'cloudflare',
    },
  });
}

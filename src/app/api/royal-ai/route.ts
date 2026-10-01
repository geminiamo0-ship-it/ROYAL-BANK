import { createClient } from '@/lib/supabase/server';
import { getSupabaseServerConfig } from '@/lib/supabase/env';
import { getRoyalSupportTelegramUrl } from '@/lib/royal-support';

export const runtime = 'nodejs';
export const preferredRegion = 'dub1';
export const maxDuration = 180;

const MAX_BODY_BYTES = 16 * 1024;
const EDGE_TIMEOUT_MS = 175_000;
const DEV_EDGE_URL = 'https://royal-ai-gateway.geminiamo0.workers.dev';
const PROD_EDGE_URL = 'https://royal-ai-production.geminiamo0.workers.dev';
const PROD_SUPABASE_PROJECT_REF = 'trnvsgenmzhyuayxxdoq';
const DEV_SUPABASE_PROJECT_REF = 'dcttiqdrsvkufzjahjzw';

function jsonError(status: number, code: string, message: string) {
  return Response.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function edgeBaseUrl(): URL | null {
  const { url: supabaseUrl } = getSupabaseServerConfig();
  const normalized = supabaseUrl.toLowerCase();
  const fallback = normalized.includes(PROD_SUPABASE_PROJECT_REF)
    ? PROD_EDGE_URL
    : normalized.includes(DEV_SUPABASE_PROJECT_REF)
      ? DEV_EDGE_URL
      : process.env.VERCEL_ENV === 'production'
        ? PROD_EDGE_URL
        : DEV_EDGE_URL;
  const raw = process.env.ROYAL_AI_EDGE_URL?.trim() || fallback;
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
  if (!base) return jsonError(503, 'ROYAL_AI_NOT_CONFIGURED', 'Royal AI is not configured.');

  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token || null;
  if (!accessToken) return jsonError(401, 'AUTH_REQUIRED', 'Authentication required.');

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(accessToken);
  const claims = claimsData?.claims as Record<string, unknown> | undefined;
  if (claimsError || claims?.role !== 'authenticated' || typeof claims?.sub !== 'string') {
    return jsonError(401, 'INVALID_AUTH_TOKEN', 'Authentication token is invalid.');
  }

  const upstreamUrl = new URL(base.toString());
  upstreamUrl.pathname = (upstreamUrl.pathname + '/chat').replace(/\/+/g, '/');

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        accept: 'text/event-stream, application/json',
      },
      body,
      signal: AbortSignal.timeout(EDGE_TIMEOUT_MS),
    });
  } catch (error) {
    return timedOut(error)
      ? jsonError(504, 'ROYAL_AI_TIMEOUT', 'Royal AI took too long. Please try again.')
      : jsonError(502, 'ROYAL_AI_UNAVAILABLE', 'Royal AI is temporarily unavailable.');
  }

  const contentType = upstream.headers.get('content-type') || 'application/json; charset=utf-8';

  if (contentType.includes('text/event-stream') && upstream.body) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'cache-control': 'no-cache, no-store',
        'content-type': 'text/event-stream; charset=utf-8',
        'x-accel-buffering': 'no',
        'x-royal-ai-proxy': 'cloudflare',
      },
    });
  }

  const raw = await upstream.text();
  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const errorCode =
        parsed.error && typeof parsed.error === 'object' && !Array.isArray(parsed.error)
          ? (parsed.error as { code?: unknown }).code
          : null;
      if (errorCode === 'ROYAL_AI_DAILY_LIMIT') parsed.supportUrl = getRoyalSupportTelegramUrl();
      return Response.json(parsed, {
        status: upstream.status,
        headers: { 'cache-control': 'no-store', 'x-royal-ai-proxy': 'cloudflare' },
      });
    } catch {}
  }

  return new Response(raw, {
    status: upstream.status,
    headers: {
      'cache-control': 'no-store',
      'content-type': contentType,
      'x-royal-ai-proxy': 'cloudflare',
    },
  });
}

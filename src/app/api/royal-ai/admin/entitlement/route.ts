import { createClient } from '@/lib/supabase/server';
import { getSupabaseServerConfig } from '@/lib/supabase/env';

export const runtime = 'nodejs';
export const preferredRegion = 'dub1';
export const maxDuration = 30;

const MAX_BODY_BYTES = 8 * 1024;
const EDGE_TIMEOUT_MS = 20_000;
const DEV_EDGE_URL = 'https://royal-ai-gateway.geminiamo0.workers.dev';
const PROD_EDGE_URL = 'https://royal-ai-production.geminiamo0.workers.dev';
const PROD_SUPABASE_PROJECT_REF = 'trnvsgenmzhyuayxxdoq';
const DEV_SUPABASE_PROJECT_REF = 'dcttiqdrsvkufzjahjzw';

function jsonError(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status, headers: { 'cache-control': 'no-store' } });
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

export async function POST(request: Request): Promise<Response> {
  const length = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return jsonError(413, 'REQUEST_TOO_LARGE', 'Request is too large.');
  }

  let body: string;
  try { body = await request.text(); }
  catch { return jsonError(400, 'INVALID_REQUEST', 'Invalid request.'); }

  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token || null;
  if (!accessToken) return jsonError(401, 'AUTH_REQUIRED', 'Authentication required.');

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(accessToken);
  const claims = claimsData?.claims as Record<string, unknown> | undefined;
  if (claimsError || claims?.role !== 'authenticated' || typeof claims?.sub !== 'string') {
    return jsonError(401, 'INVALID_AUTH_TOKEN', 'Authentication token is invalid.');
  }

  const base = edgeBaseUrl();
  if (!base) return jsonError(503, 'ROYAL_AI_NOT_CONFIGURED', 'Royal AI is not configured.');
  const upstreamUrl = new URL(base.toString());
  upstreamUrl.pathname = (upstreamUrl.pathname + '/admin/entitlement').replace(/\/+/g, '/');

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
  } catch {
    return jsonError(502, 'ROYAL_AI_ADMIN_UNAVAILABLE', 'Royal AI allowance service is temporarily unavailable.');
  }

  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      'cache-control': 'no-store',
      'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      'x-royal-ai-admin-proxy': 'cloudflare',
    },
  });
}

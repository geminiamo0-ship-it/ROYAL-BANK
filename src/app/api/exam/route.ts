import { createClient } from '@supabase/supabase-js';
import { checkVercelRateLimit } from '@/lib/vercel-firewall-rate-limit';
import { EXAM_RPC_BY_ACTION, parseExamGatewayRequest } from '@/lib/exam-gateway-contract';
import {
  audienceIncludesAuthenticated,
  buildGatewayProof,
  gatewayHeaders,
  jsonError,
  PINNED_SUPABASE_JWKS,
  pinnedJwkForHeader,
  readBearerToken,
  readJwtHeader,
  safeUpstreamErrorBody,
  serverTimingHeader,
  type GatewayProof,
} from '@/lib/exam-gateway-server';
import { getSupabaseServerConfig } from '@/lib/supabase/env';
import type { ExamGatewayAction } from '@/types/exam-gateway';

export const runtime = 'nodejs';
export const preferredRegion = 'dub1';
export const maxDuration = 10;

const MAX_BODY_BYTES = 32 * 1024;
const RATE_LIMIT_RETRY_AFTER_SECONDS = 60;
const RATE_LIMIT_RECORD_TIMEOUT_MS = 1500;

const RATE_LIMIT_FAIL_OPEN_ACTIONS = new Set<ExamGatewayAction>([
  'submit',
  'submitRaw',
  'feedback',
  'flag',
  'complete',
]);

function requiresPasswordChange(claims: unknown): boolean {
  if (!claims || typeof claims !== 'object') return false;
  const appMetadata = (claims as { app_metadata?: unknown }).app_metadata;
  return Boolean(
    appMetadata &&
      typeof appMetadata === 'object' &&
      !Array.isArray(appMetadata) &&
      (appMetadata as Record<string, unknown>).must_change_password === true,
  );
}

async function recordRateLimitRejection(options: {
  supabaseUrl: string;
  publishableKey: string;
  accessToken: string;
  proof: GatewayProof;
  action: ExamGatewayAction;
}) {
  try {
    await fetch(
      `${options.supabaseUrl}/rest/v1/rpc/record_exam_gateway_rate_limit_rejection`,
      {
        method: 'POST',
        cache: 'no-store',
        headers: gatewayHeaders(options.publishableKey, options.accessToken, options.proof),
        body: JSON.stringify({ p_action: options.action }),
        signal: AbortSignal.timeout(RATE_LIMIT_RECORD_TIMEOUT_MS),
      },
    );
  } catch {
    // The request is already rejected by Vercel. Abuse accounting is deliberately
    // best-effort so a telemetry failure cannot turn a 429 into a slower 5xx path.
  }
}

export async function POST(request: Request) {
  const totalServerStart = performance.now();
  let bodyParseMs = 0;
  let authMs = 0;
  let rateLimitMs = 0;
  let upstreamFetchMs = 0;
  let responseReadMs = 0;

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return jsonError(413, 'REQUEST_TOO_LARGE', 'Request is too large.');
  }

  const accessToken = readBearerToken(request);
  if (!accessToken) {
    return jsonError(401, 'AUTH_REQUIRED', 'Authentication required.');
  }

  const { url: supabaseUrl, publishableKey } = getSupabaseServerConfig();
  const gatewayKeyId = process.env.ROYAL_GATEWAY_KEY_ID || '';
  const gatewayKey = process.env.ROYAL_GATEWAY_KEY || '';
  const riskHmacSecret = process.env.ROYAL_RISK_HMAC_SECRET || '';
  const rateLimitEnabled = process.env.ROYAL_GATEWAY_RATE_LIMIT_ENABLED === 'true';
  const rateLimitId = process.env.ROYAL_GATEWAY_RATE_LIMIT_ID || '';
  const serverTimingEnabled = process.env.ROYAL_GATEWAY_TIMING_ENABLED === 'true';

  if (!supabaseUrl || !publishableKey || !gatewayKeyId || !gatewayKey || !riskHmacSecret) {
    return jsonError(503, 'EXAM_GATEWAY_NOT_CONFIGURED', 'Exam gateway is not configured.');
  }

  if (rateLimitEnabled && !rateLimitId) {
    return jsonError(503, 'EXAM_RATE_LIMIT_NOT_CONFIGURED', 'Exam rate limit is not configured.');
  }

  if (PINNED_SUPABASE_JWKS.kind === 'invalid') {
    return jsonError(503, 'EXAM_AUTH_NOT_CONFIGURED', 'Exam authentication is not configured.');
  }

  const bodyParseStart = performance.now();
  let rawRequestBody: unknown;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return jsonError(413, 'REQUEST_TOO_LARGE', 'Request is too large.');
    }
    rawRequestBody = JSON.parse(rawBody) as unknown;
  } catch {
    return jsonError(400, 'INVALID_REQUEST', 'Invalid request body.');
  }

  const parsedRequest = parseExamGatewayRequest(rawRequestBody);
  bodyParseMs = performance.now() - bodyParseStart;

  if (!parsedRequest.ok) {
    if (parsedRequest.code === 'INVALID_EXAM_ACTION') {
      return jsonError(400, 'INVALID_EXAM_ACTION', 'Unsupported exam action.');
    }
    return jsonError(400, 'INVALID_REQUEST', 'Invalid exam RPC arguments.');
  }

  const body = parsedRequest.value;
  const authStart = performance.now();

  // Verify the JWT before using sub as a security/rate-limit identity. When a
  // public SUPABASE_JWKS value is pinned in the server environment, getClaims()
  // verifies ES256/RS256 signatures entirely in-process and never needs the JWKS
  // discovery request on this hot path. Without the optional pin, preserve the
  // managed getClaims() JWKS cache/fallback behavior.
  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    db: {
      retry: false,
    },
  });

  if (PINNED_SUPABASE_JWKS.kind === 'ready') {
    const header = readJwtHeader(accessToken);
    if (!header) {
      return jsonError(401, 'INVALID_AUTH_TOKEN', 'Authentication token is invalid.');
    }

    if (!pinnedJwkForHeader(PINNED_SUPABASE_JWKS.jwks, header)) {
      return jsonError(
        503,
        'EXAM_AUTH_KEY_UNAVAILABLE',
        'Exam authentication is temporarily unavailable.',
      );
    }
  }

  const { data: claimsData, error: claimsError } =
    PINNED_SUPABASE_JWKS.kind === 'ready'
      ? await authClient.auth.getClaims(accessToken, { jwks: PINNED_SUPABASE_JWKS.jwks })
      : await authClient.auth.getClaims(accessToken);

  const claims = claimsData?.claims;
  const userId = claims?.sub;
  const expectedIssuer = `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`;

  if (
    claimsError ||
    typeof userId !== 'string' ||
    !userId ||
    claims?.iss !== expectedIssuer ||
    !audienceIncludesAuthenticated(claims?.aud) ||
    claims?.role !== 'authenticated'
  ) {
    return jsonError(401, 'INVALID_AUTH_TOKEN', 'Authentication token is invalid.');
  }

  if (requiresPasswordChange(claims)) {
    return jsonError(
      403,
      'PASSWORD_CHANGE_REQUIRED',
      'Change your password before continuing.',
    );
  }

  authMs = performance.now() - authStart;

  const proof = buildGatewayProof({
    request,
    gatewayKeyId,
    gatewayKey,
    riskHmacSecret,
  });

  const rateLimitStart = performance.now();

  if (rateLimitEnabled) {
    try {
      const { rateLimited, error: rateLimitError } = await checkVercelRateLimit(rateLimitId, {
        request,
        rateLimitKey: userId,
      });

      if (rateLimitError) {
        if (!RATE_LIMIT_FAIL_OPEN_ACTIONS.has(body.action)) {
          return jsonError(
            503,
            'EXAM_RATE_LIMIT_UNAVAILABLE',
            'Exam service is temporarily unavailable.',
          );
        }
      } else if (rateLimited) {
        await recordRateLimitRejection({
          supabaseUrl,
          publishableKey,
          accessToken,
          proof,
          action: body.action,
        });

        return jsonError(
          429,
          'RATE_LIMITED',
          'Too many requests. Try again shortly.',
          RATE_LIMIT_RETRY_AFTER_SECONDS,
        );
      }
    } catch {
      if (!RATE_LIMIT_FAIL_OPEN_ACTIONS.has(body.action)) {
        return jsonError(
          503,
          'EXAM_RATE_LIMIT_UNAVAILABLE',
          'Exam service is temporarily unavailable.',
        );
      }
    }
  }

  rateLimitMs = performance.now() - rateLimitStart;
  const rpcName = EXAM_RPC_BY_ACTION[body.action];

  const upstreamFetchStart = performance.now();
  let upstream: Response;
  try {
    upstream = await fetch(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
      method: 'POST',
      cache: 'no-store',
      headers: gatewayHeaders(publishableKey, accessToken, proof),
      body: JSON.stringify(body.args),
    });
  } catch {
    return jsonError(502, 'EXAM_UPSTREAM_UNAVAILABLE', 'Exam service is temporarily unavailable.');
  }
  upstreamFetchMs = performance.now() - upstreamFetchStart;

  const responseReadStart = performance.now();
  const rawResponseBody = await upstream.text();
  responseReadMs = performance.now() - responseReadStart;
  const responseBody = upstream.ok ? rawResponseBody : safeUpstreamErrorBody(rawResponseBody);

  const headers = new Headers({
    'content-type': upstream.ok
      ? upstream.headers.get('content-type') || 'application/json; charset=utf-8'
      : 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });

  const retryAfter = upstream.headers.get('retry-after');
  if (retryAfter) headers.set('retry-after', retryAfter);

  if (serverTimingEnabled) {
    headers.set(
      'server-timing',
      serverTimingHeader({
        bodyParseMs,
        authMs,
        rateLimitMs,
        upstreamFetchMs,
        responseReadMs,
        totalServerMs: performance.now() - totalServerStart,
      }),
    );
  }

  return new Response(responseBody, {
    status: upstream.status,
    headers,
  });
}

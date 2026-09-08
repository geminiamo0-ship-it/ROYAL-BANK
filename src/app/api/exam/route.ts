import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { checkVercelRateLimit } from '@/lib/vercel-firewall-rate-limit';
import { getSupabaseServerConfig } from '@/lib/supabase/env';

export const runtime = 'nodejs';
export const preferredRegion = 'dub1';
export const maxDuration = 10;

const MAX_BODY_BYTES = 32 * 1024;
const RATE_LIMIT_RETRY_AFTER_SECONDS = 60;
const RATE_LIMIT_RECORD_TIMEOUT_MS = 1500;
const SUPPORTED_PINNED_JWT_ALGORITHMS = new Set(['ES256', 'RS256']);

const RPC_BY_ACTION = {
  create: 'create_exam_session_bootstrap_idempotent',
  bootstrap: 'get_exam_session_bootstrap',
  window: 'get_exam_session_window',
  submit: 'submit_exam_answer_with_feedback',
  submitRaw: 'submit_exam_answer',
  feedback: 'get_exam_question_feedback',
  flag: 'set_question_flag',
  complete: 'complete_exam_session',
} as const;

const RATE_LIMIT_FAIL_OPEN_ACTIONS = new Set<ExamGatewayAction>([
  'submit',
  'submitRaw',
  'feedback',
  'flag',
  'complete',
]);

type ExamGatewayAction = keyof typeof RPC_BY_ACTION;

type ExamGatewayBody = {
  action?: string;
  args?: Record<string, unknown>;
};

type GatewayProof = {
  gatewayKeyId: string;
  gatewayKey: string;
  ipHmac: string;
  userAgentHmac: string;
};

type SupabaseJwk = {
  kty: string;
  key_ops: string[];
  alg?: string;
  kid?: string;
  crv?: string;
  [key: string]: unknown;
};

type SupabaseJwks = {
  keys: SupabaseJwk[];
};

type PinnedJwksState =
  | { kind: 'disabled' }
  | { kind: 'invalid' }
  | { kind: 'ready'; jwks: SupabaseJwks };

type JwtHeader = {
  alg: string;
  kid: string;
};

type ExamServerTimings = {
  bodyParseMs: number;
  authMs: number;
  rateLimitMs: number;
  upstreamFetchMs: number;
  responseReadMs: number;
  totalServerMs: number;
};

function parsePinnedSupabaseJwks(rawValue: string | undefined): PinnedJwksState {
  const raw = rawValue?.trim();
  if (!raw) return { kind: 'disabled' };

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { kind: 'invalid' };
    }

    const keys = (parsed as { keys?: unknown }).keys;
    if (!Array.isArray(keys) || keys.length === 0) {
      return { kind: 'invalid' };
    }

    for (const candidate of keys) {
      if (candidate == null || typeof candidate !== 'object' || Array.isArray(candidate)) {
        return { kind: 'invalid' };
      }

      const key = candidate as Record<string, unknown>;
      if (
        typeof key.kty !== 'string' ||
        typeof key.kid !== 'string' ||
        !key.kid ||
        !Array.isArray(key.key_ops) ||
        !key.key_ops.every((operation) => typeof operation === 'string')
      ) {
        return { kind: 'invalid' };
      }
    }

    return { kind: 'ready', jwks: parsed as SupabaseJwks };
  } catch {
    return { kind: 'invalid' };
  }
}

const PINNED_SUPABASE_JWKS = parsePinnedSupabaseJwks(process.env.SUPABASE_JWKS);

function jsonError(status: number, code: string, message: string, retryAfter?: number) {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });

  if (retryAfter != null) headers.set('retry-after', String(retryAfter));

  return Response.json(
    { error: { code, message } },
    { status, headers }
  );
}

function serverTimingHeader(timings: ExamServerTimings): string {
  return [
    `body_parse;dur=${timings.bodyParseMs.toFixed(1)}`,
    `auth;dur=${timings.authMs.toFixed(1)}`,
    `rate_limit;dur=${timings.rateLimitMs.toFixed(1)}`,
    `upstream_fetch;dur=${timings.upstreamFetchMs.toFixed(1)}`,
    `response_read;dur=${timings.responseReadMs.toFixed(1)}`,
    `total_server;dur=${timings.totalServerMs.toFixed(1)}`,
  ].join(', ');
}

function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  return token || null;
}

function readJwtHeader(token: string): JwtHeader | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0]) return null;

  try {
    const decoded = Buffer.from(parts[0], 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded) as unknown;
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const header = parsed as Record<string, unknown>;
    if (typeof header.alg !== 'string' || typeof header.kid !== 'string' || !header.kid) {
      return null;
    }

    return { alg: header.alg, kid: header.kid };
  } catch {
    return null;
  }
}

function pinnedJwkForHeader(jwks: SupabaseJwks, header: JwtHeader): SupabaseJwk | null {
  if (!SUPPORTED_PINNED_JWT_ALGORITHMS.has(header.alg)) return null;

  const key = jwks.keys.find((candidate) => candidate.kid === header.kid);
  if (!key) return null;
  if (key.alg && key.alg !== header.alg) return null;
  if (!key.key_ops.includes('verify')) return null;

  if (header.alg === 'ES256' && (key.kty !== 'EC' || key.crv !== 'P-256')) return null;
  if (header.alg === 'RS256' && key.kty !== 'RSA') return null;

  return key;
}

function audienceIncludesAuthenticated(audience: unknown): boolean {
  return (
    audience === 'authenticated' ||
    (Array.isArray(audience) && audience.some((value) => value === 'authenticated'))
  );
}

function hmacSignal(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function getRequestIp(request: Request): string {
  return (
    request.headers.get('x-vercel-forwarded-for') ||
    request.headers.get('x-forwarded-for') ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
    .split(',')[0]
    .trim();
}

function normalizeUserAgent(request: Request): string {
  return (request.headers.get('user-agent') || 'unknown').trim().slice(0, 512);
}

function isAllowedAction(value: string): value is ExamGatewayAction {
  return Object.prototype.hasOwnProperty.call(RPC_BY_ACTION, value);
}

function gatewayHeaders(
  publishableKey: string,
  accessToken: string,
  proof: GatewayProof
): Record<string, string> {
  return {
    apikey: publishableKey,
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
    accept: 'application/json',
    'x-royal-gateway-key-id': proof.gatewayKeyId,
    'x-royal-gateway-key': proof.gatewayKey,
    'x-royal-ip-hmac': proof.ipHmac,
    'x-royal-ua-hmac': proof.userAgentHmac,
    'x-royal-gateway-version': '1',
  };
}

function safeUpstreamErrorBody(responseBody: string): string {
  try {
    const parsed = JSON.parse(responseBody) as Record<string, unknown>;
    const rawMessage = typeof parsed.message === 'string' ? parsed.message.trim() : '';
    const rawCode = typeof parsed.code === 'string' ? parsed.code.trim() : '';
    const sensitive = /supabase|postgrest|postgres|https?:\/\/|\.supabase\.co/i;
    const safeMessage =
      rawMessage && rawMessage.length <= 240 && !sensitive.test(rawMessage)
        ? rawMessage
        : 'Exam request failed.';
    const safeCode = /^[A-Z][A-Z0-9_]{1,63}$/.test(rawMessage)
      ? rawMessage
      : /^[A-Z][A-Z0-9_]{1,63}$/.test(rawCode)
        ? rawCode
        : 'EXAM_REQUEST_FAILED';

    return JSON.stringify({ error: { code: safeCode, message: safeMessage } });
  } catch {
    return JSON.stringify({
      error: { code: 'EXAM_REQUEST_FAILED', message: 'Exam request failed.' },
    });
  }
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
      }
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
  let body: ExamGatewayBody;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return jsonError(413, 'REQUEST_TOO_LARGE', 'Request is too large.');
    }
    body = JSON.parse(rawBody) as ExamGatewayBody;
  } catch {
    return jsonError(400, 'INVALID_REQUEST', 'Invalid request body.');
  }
  bodyParseMs = performance.now() - bodyParseStart;

  if (!body.action || !isAllowedAction(body.action)) {
    return jsonError(400, 'INVALID_EXAM_ACTION', 'Unsupported exam action.');
  }

  if (body.args == null || typeof body.args !== 'object' || Array.isArray(body.args)) {
    return jsonError(400, 'INVALID_REQUEST', 'Exam RPC arguments are required.');
  }

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
        'Exam authentication is temporarily unavailable.'
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

  authMs = performance.now() - authStart;

  const proof: GatewayProof = {
    gatewayKeyId,
    gatewayKey,
    ipHmac: hmacSignal(riskHmacSecret, getRequestIp(request)),
    userAgentHmac: hmacSignal(riskHmacSecret, normalizeUserAgent(request)),
  };

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
            'Exam service is temporarily unavailable.'
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
          RATE_LIMIT_RETRY_AFTER_SECONDS
        );
      }
    } catch {
      if (!RATE_LIMIT_FAIL_OPEN_ACTIONS.has(body.action)) {
        return jsonError(
          503,
          'EXAM_RATE_LIMIT_UNAVAILABLE',
          'Exam service is temporarily unavailable.'
        );
      }
    }
  }

  rateLimitMs = performance.now() - rateLimitStart;

  const rpcName = RPC_BY_ACTION[body.action];

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
      })
    );
  }

  return new Response(responseBody, {
    status: upstream.status,
    headers,
  });
}

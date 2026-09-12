import 'server-only';

import { createHmac } from 'node:crypto';

const SUPPORTED_PINNED_JWT_ALGORITHMS = new Set(['ES256', 'RS256']);

export type GatewayProof = {
  gatewayKeyId: string;
  gatewayKey: string;
  ipHmac: string;
  userAgentHmac: string;
};

export type SupabaseJwk = {
  kty: string;
  key_ops: string[];
  alg?: string;
  kid?: string;
  crv?: string;
  [key: string]: unknown;
};

export type SupabaseJwks = {
  keys: SupabaseJwk[];
};

// Public verification material for the current Production Supabase ES256 signing key.
// It is not a secret. Keeping the current key in-process avoids a JWKS network fetch
// on every cold serverless isolate when SUPABASE_JWKS has not been configured in
// Vercel. An explicit SUPABASE_JWKS environment value still overrides this fallback,
// so planned key rotation can be staged without a code change.
const ROYAL_PRODUCTION_SUPABASE_JWKS: SupabaseJwks = {
  keys: [
    {
      alg: 'ES256',
      crv: 'P-256',
      ext: true,
      key_ops: ['verify'],
      kid: 'ba252319-971c-449d-a46b-ed557d7c5f0c',
      kty: 'EC',
      use: 'sig',
      x: '9O64vMXjL3ZEB8KyHiJEv4mF3eIc7nQg4J7_kG5azGo',
      y: 'W4R8CjMynfGPJhCV1Rj7cJDmF0My5dj7RmpsqlYi47Q',
    },
  ],
};

type PinnedJwksState =
  | { kind: 'disabled' }
  | { kind: 'invalid' }
  | { kind: 'ready'; jwks: SupabaseJwks };

type JwtHeader = {
  alg: string;
  kid: string;
};

export type ExamServerTimings = {
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

const configuredSupabaseJwks = parsePinnedSupabaseJwks(process.env.SUPABASE_JWKS);
export const PINNED_SUPABASE_JWKS: PinnedJwksState =
  configuredSupabaseJwks.kind === 'disabled'
    ? { kind: 'ready', jwks: ROYAL_PRODUCTION_SUPABASE_JWKS }
    : configuredSupabaseJwks;

export function jsonError(status: number, code: string, message: string, retryAfter?: number) {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });

  if (retryAfter != null) headers.set('retry-after', String(retryAfter));

  return Response.json(
    { error: { code, message } },
    { status, headers },
  );
}

export function serverTimingHeader(timings: ExamServerTimings): string {
  return [
    `body_parse;dur=${timings.bodyParseMs.toFixed(1)}`,
    `auth;dur=${timings.authMs.toFixed(1)}`,
    `rate_limit;dur=${timings.rateLimitMs.toFixed(1)}`,
    `upstream_fetch;dur=${timings.upstreamFetchMs.toFixed(1)}`,
    `response_read;dur=${timings.responseReadMs.toFixed(1)}`,
    `total_server;dur=${timings.totalServerMs.toFixed(1)}`,
  ].join(', ');
}

export function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  return token || null;
}

export function readJwtHeader(token: string): JwtHeader | null {
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

export function pinnedJwkForHeader(jwks: SupabaseJwks, header: JwtHeader): SupabaseJwk | null {
  if (!SUPPORTED_PINNED_JWT_ALGORITHMS.has(header.alg)) return null;

  const key = jwks.keys.find((candidate) => candidate.kid === header.kid);
  if (!key) return null;
  if (key.alg && key.alg !== header.alg) return null;
  if (!key.key_ops.includes('verify')) return null;

  if (header.alg === 'ES256' && (key.kty !== 'EC' || key.crv !== 'P-256')) return null;
  if (header.alg === 'RS256' && key.kty !== 'RSA') return null;

  return key;
}

export function audienceIncludesAuthenticated(audience: unknown): boolean {
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

export function buildGatewayProof(options: {
  request: Request;
  gatewayKeyId: string;
  gatewayKey: string;
  riskHmacSecret: string;
}): GatewayProof {
  return {
    gatewayKeyId: options.gatewayKeyId,
    gatewayKey: options.gatewayKey,
    ipHmac: hmacSignal(options.riskHmacSecret, getRequestIp(options.request)),
    userAgentHmac: hmacSignal(options.riskHmacSecret, normalizeUserAgent(options.request)),
  };
}

export function gatewayHeaders(
  publishableKey: string,
  accessToken: string,
  proof: GatewayProof,
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

export function safeUpstreamErrorBody(responseBody: string): string {
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

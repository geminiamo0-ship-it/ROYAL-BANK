import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { checkVercelRateLimit } from '@/lib/vercel-firewall-rate-limit';

export const runtime = 'nodejs';
export const preferredRegion = 'dub1';
export const maxDuration = 10;

const MAX_BODY_BYTES = 32 * 1024;
const RATE_LIMIT_RETRY_AFTER_SECONDS = 60;
const RATE_LIMIT_RECORD_TIMEOUT_MS = 1500;

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

function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  return token || null;
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
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return jsonError(413, 'REQUEST_TOO_LARGE', 'Request is too large.');
  }

  const accessToken = readBearerToken(request);
  if (!accessToken) {
    return jsonError(401, 'AUTH_REQUIRED', 'Authentication required.');
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const gatewayKeyId = process.env.ROYAL_GATEWAY_KEY_ID || '';
  const gatewayKey = process.env.ROYAL_GATEWAY_KEY || '';
  const riskHmacSecret = process.env.ROYAL_RISK_HMAC_SECRET || '';
  const rateLimitEnabled = process.env.ROYAL_GATEWAY_RATE_LIMIT_ENABLED === 'true';
  const rateLimitId = process.env.ROYAL_GATEWAY_RATE_LIMIT_ID || '';

  if (!supabaseUrl || !publishableKey || !gatewayKeyId || !gatewayKey || !riskHmacSecret) {
    return jsonError(503, 'EXAM_GATEWAY_NOT_CONFIGURED', 'Exam gateway is not configured.');
  }

  if (rateLimitEnabled && !rateLimitId) {
    return jsonError(503, 'EXAM_RATE_LIMIT_NOT_CONFIGURED', 'Exam rate limit is not configured.');
  }

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

  if (!body.action || !isAllowedAction(body.action)) {
    return jsonError(400, 'INVALID_EXAM_ACTION', 'Unsupported exam action.');
  }

  if (body.args == null || typeof body.args !== 'object' || Array.isArray(body.args)) {
    return jsonError(400, 'INVALID_REQUEST', 'Exam RPC arguments are required.');
  }

  // Verify the JWT before using sub as a security/rate-limit identity. getClaims()
  // verifies Supabase-issued access tokens against the project's JWKS when possible
  // and falls back to the Auth server for legacy symmetric signing keys.
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

  const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(accessToken);
  const userId = claimsData?.claims?.sub;

  if (claimsError || typeof userId !== 'string' || !userId) {
    return jsonError(401, 'INVALID_AUTH_TOKEN', 'Authentication token is invalid.');
  }

  const proof: GatewayProof = {
    gatewayKeyId,
    gatewayKey,
    ipHmac: hmacSignal(riskHmacSecret, getRequestIp(request)),
    userAgentHmac: hmacSignal(riskHmacSecret, normalizeUserAgent(request)),
  };

  // N: durable Vercel-side request limiting keyed by the VERIFIED JWT subject.
  // On Hobby this is intentionally one aggregate rule (target: 60 requests/minute)
  // rather than a distributed in-memory counter. Existing DB guardrails remain the
  // authoritative content/session quotas and are stricter for fresh-content abuse.
  if (rateLimitEnabled) {
    try {
      const { rateLimited, error: rateLimitError } = await checkVercelRateLimit(rateLimitId, {
        request,
        rateLimitKey: userId,
      });

      // A missing rule or a blocked internal check is configuration/infrastructure
      // failure, not user abuse. Preserve progress writes but fail closed for actions
      // that can disclose fresh content.
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
      // If the optional edge limiter itself is unavailable, preserve progress actions
      // but fail closed for actions capable of disclosing fresh question content.
      if (!RATE_LIMIT_FAIL_OPEN_ACTIONS.has(body.action)) {
        return jsonError(
          503,
          'EXAM_RATE_LIMIT_UNAVAILABLE',
          'Exam service is temporarily unavailable.'
        );
      }
    }
  }

  const rpcName = RPC_BY_ACTION[body.action];

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

  const responseBody = await upstream.text();
  const headers = new Headers({
    'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });

  const retryAfter = upstream.headers.get('retry-after');
  if (retryAfter) headers.set('retry-after', retryAfter);

  return new Response(responseBody, {
    status: upstream.status,
    headers,
  });
}

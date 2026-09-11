import { createClient } from '@supabase/supabase-js';
import { checkVercelRateLimit } from '@/lib/vercel-firewall-rate-limit';
import { EXAM_RPC_BY_ACTION, parseExamGatewayRequest } from '@/lib/exam-gateway-contract';
import {
  hydrateExamR2Response,
  isExamR2ContentEnabled,
  r2RpcNameForAction,
} from '@/lib/exam-r2-content';
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
import {
  attachExamWindowAccess,
  EXAM_WINDOW_ACCESS_HEADER,
  trySignedExamWindowFastPath,
} from '@/lib/exam-window-fast-path';
import { getSupabaseServerConfig } from '@/lib/supabase/env';
import type { ExamGatewayAction } from '@/types/exam-gateway';

export const runtime = 'nodejs';
export const preferredRegion = 'dub1';
export const maxDuration = 10;

const MAX_BODY_BYTES = 32 * 1024;
const RATE_LIMIT_RETRY_AFTER_SECONDS = 60;
const RATE_LIMIT_RECORD_TIMEOUT_MS = 1500;
const EXAM_UPSTREAM_TIMEOUT_MS = 6500;
const EXAM_REQUEST_BUDGET_MS = 9000;

const RATE_LIMIT_FAIL_OPEN_ACTIONS = new Set<ExamGatewayAction>([
  'submit',
  'submitRaw',
  'feedback',
  'trainingFeedback',
  'flag',
  'complete',
]);

type JsonObject = Record<string, unknown>;

function asJsonObject(value: unknown): JsonObject | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

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

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
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

function addServerTiming(
  headers: Headers,
  enabled: boolean,
  metrics: {
    bodyParseMs: number;
    authMs: number;
    rateLimitMs: number;
    upstreamFetchMs: number;
    responseReadMs: number;
    totalServerMs: number;
  },
): void {
  if (!enabled) return;
  headers.set('server-timing', serverTimingHeader(metrics));
}

export async function POST(request: Request) {
  const totalServerStart = performance.now();
  const requestDeadline = totalServerStart + EXAM_REQUEST_BUDGET_MS;
  const responseRequestId = crypto.randomUUID();
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
  const windowAction = body.action === 'window' || body.action === 'reviewWindow';
  const windowAccessPresented = Boolean(request.headers.get(EXAM_WINDOW_ACCESS_HEADER));
  const authStart = performance.now();

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

  const validateAuthoritativeUser = async (): Promise<Response | null> => {
    const currentUserStart = performance.now();
    const {
      data: { user },
      error,
    } = await authClient.auth.getUser(accessToken);
    authMs += performance.now() - currentUserStart;

    if (error || !user || user.id !== userId) {
      return jsonError(401, 'INVALID_AUTH_TOKEN', 'Authentication token is invalid.');
    }
    if (user.app_metadata?.must_change_password === true) {
      return jsonError(
        403,
        'PASSWORD_CHANGE_REQUIRED',
        'Change your password before continuing.',
      );
    }
    return null;
  };

  // A caller cannot use the fast-path header to weaken authentication for any
  // mutating or feedback action. Those requests are revalidated authoritatively.
  if (windowAccessPresented && !windowAction) {
    const authError = await validateAuthoritativeUser();
    if (authError) return authError;
  }

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

  const r2ContentEnabled = isExamR2ContentEnabled();
  if (r2ContentEnabled && windowAction) {
    const fastPathStart = performance.now();
    const fastPathBody = await trySignedExamWindowFastPath({
      request,
      action: body.action,
      args: body.args,
      userId,
      secret: riskHmacSecret,
    });
    upstreamFetchMs = performance.now() - fastPathStart;

    if (fastPathBody != null) {
      const headers = new Headers({
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-royal-request-id': responseRequestId,
      });
      addServerTiming(headers, serverTimingEnabled, {
        bodyParseMs,
        authMs,
        rateLimitMs,
        upstreamFetchMs,
        responseReadMs,
        totalServerMs: performance.now() - totalServerStart,
      });
      return new Response(fastPathBody, { status: 200, headers });
    }

    // The middleware intentionally avoids its remote user lookup only when a
    // signed window capability is presented. If that capability does not verify
    // or cannot be served, restore authoritative validation before any fallback.
    if (windowAccessPresented) {
      const authError = await validateAuthoritativeUser();
      if (authError) return authError;
    }
  }

  const legacyRpcName = EXAM_RPC_BY_ACTION[body.action];
  const r2RpcName = r2ContentEnabled ? r2RpcNameForAction(body.action) : null;
  const primaryRpcName = r2RpcName || legacyRpcName;

  const callRpc = (rpcName: string, args: Record<string, unknown> = body.args) => {
    const remainingBudget = Math.max(1, Math.floor(requestDeadline - performance.now()));
    const timeoutMs = Math.max(1, Math.min(EXAM_UPSTREAM_TIMEOUT_MS, remainingBudget));
    return fetch(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
      method: 'POST',
      cache: 'no-store',
      headers: gatewayHeaders(publishableKey, accessToken, proof),
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(timeoutMs),
    });
  };

  const upstreamFetchStart = performance.now();
  let upstream: Response;
  try {
    upstream = await callRpc(primaryRpcName);
  } catch (error) {
    if (isTimeoutError(error)) {
      return jsonError(504, 'EXAM_UPSTREAM_TIMEOUT', 'Exam service took too long to respond.');
    }
    return jsonError(502, 'EXAM_UPSTREAM_UNAVAILABLE', 'Exam service is temporarily unavailable.');
  }
  upstreamFetchMs += performance.now() - upstreamFetchStart;

  const responseReadStart = performance.now();
  let rawResponseBody = await upstream.text();
  responseReadMs = performance.now() - responseReadStart;

  // A failed primary RPC is authoritative. Never turn a permission/session error
  // into another attempt through a different RPC. Content fallback is only for a
  // successful read whose R2 object could not be hydrated.
  if (r2RpcName && upstream.ok) {
    let hydratedBody: string | null = null;

    try {
      hydratedBody = await hydrateExamR2Response(body.action, rawResponseBody);
    } catch {
      hydratedBody = null;
    }

    if (hydratedBody != null) {
      rawResponseBody = hydratedBody;
    } else if (body.action === 'submit') {
      // The mutation has already committed successfully. A missing/slow R2 object
      // must never cause a second submit. Recover feedback through a read-only RPC;
      // if that also fails, report the save as successful with feedback pending.
      let submitResult: JsonObject | null = null;
      try {
        submitResult = asJsonObject(JSON.parse(rawResponseBody) as unknown);
      } catch {
        submitResult = null;
      }

      const sessionId = body.args.p_session_id;
      const questionId = body.args.p_question_id;
      if (
        submitResult &&
        asJsonObject(submitResult.answer) &&
        typeof sessionId === 'string' &&
        typeof questionId === 'number'
      ) {
        const feedbackFetchStart = performance.now();
        try {
          const feedbackResponse = await callRpc(EXAM_RPC_BY_ACTION.feedback, {
            p_session_id: sessionId,
            p_question_id: questionId,
          });
          upstreamFetchMs += performance.now() - feedbackFetchStart;

          const feedbackReadStart = performance.now();
          const feedbackBody = await feedbackResponse.text();
          responseReadMs += performance.now() - feedbackReadStart;

          if (feedbackResponse.ok) {
            const feedback = JSON.parse(feedbackBody) as unknown;
            rawResponseBody = JSON.stringify({ ...submitResult, feedback });
          } else {
            rawResponseBody = JSON.stringify({
              ...submitResult,
              feedback: null,
              feedback_pending: true,
            });
          }
        } catch {
          upstreamFetchMs += performance.now() - feedbackFetchStart;
          rawResponseBody = JSON.stringify({
            ...submitResult,
            feedback: null,
            feedback_pending: true,
          });
        }
      }
    } else {
      // All remaining R2-enabled actions are reads. They may safely fall back to
      // the full Postgres read without repeating any mutation.
      const fallbackFetchStart = performance.now();
      try {
        upstream = await callRpc(legacyRpcName);
      } catch (error) {
        if (isTimeoutError(error)) {
          return jsonError(504, 'EXAM_UPSTREAM_TIMEOUT', 'Exam service took too long to respond.');
        }
        return jsonError(502, 'EXAM_UPSTREAM_UNAVAILABLE', 'Exam service is temporarily unavailable.');
      }
      upstreamFetchMs += performance.now() - fallbackFetchStart;

      const fallbackReadStart = performance.now();
      rawResponseBody = await upstream.text();
      responseReadMs += performance.now() - fallbackReadStart;
    }
  }

  if (upstream.ok && r2ContentEnabled) {
    rawResponseBody = attachExamWindowAccess({
      action: body.action,
      rawBody: rawResponseBody,
      userId,
      secret: riskHmacSecret,
    });
  }

  const responseBody = upstream.ok ? rawResponseBody : safeUpstreamErrorBody(rawResponseBody);

  const headers = new Headers({
    'content-type': upstream.ok
      ? upstream.headers.get('content-type') || 'application/json; charset=utf-8'
      : 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-royal-request-id': responseRequestId,
  });

  const retryAfter = upstream.headers.get('retry-after');
  if (retryAfter) headers.set('retry-after', retryAfter);

  addServerTiming(headers, serverTimingEnabled, {
    bodyParseMs,
    authMs,
    rateLimitMs,
    upstreamFetchMs,
    responseReadMs,
    totalServerMs: performance.now() - totalServerStart,
  });

  return new Response(responseBody, {
    status: upstream.status,
    headers,
  });
}

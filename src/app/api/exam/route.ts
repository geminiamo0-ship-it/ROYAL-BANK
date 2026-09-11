import { createClient } from '@supabase/supabase-js';
import { checkVercelRateLimit } from '@/lib/vercel-firewall-rate-limit';
import { EXAM_RPC_BY_ACTION, parseExamGatewayRequest } from '@/lib/exam-gateway-contract';
import {
  hydrateExamR2Response,
  isExamR2ContentEnabled,
  r2RpcNameForAction,
  resolveActiveExamContentRelease,
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
const ACTIVE_RELEASE_LOOKUP_CAP_MS = 1800;
const RELEASE_ID_PATTERN = /^[0-9a-f]{64}$/;

const RATE_LIMIT_FAIL_OPEN_ACTIONS = new Set<ExamGatewayAction>([
  'submit',
  'submitRaw',
  'feedback',
  'trainingFeedback',
  'flag',
  'complete',
]);

// Only Create may choose a release. Resume/review must report the release already
// stored on the session so pre-065 sessions remain explicit legacy sessions.
const RELEASE_PIN_ACTIONS = new Set<ExamGatewayAction>(['create']);

type JsonObject = Record<string, unknown>;
type ContentReleaseState = 'pinned' | 'legacy' | 'invalid';

class ExamRequestBudgetError extends Error {
  constructor() {
    super('EXAM_REQUEST_TIMEOUT');
    this.name = 'ExamRequestBudgetError';
  }
}

function asJsonObject(value: unknown): JsonObject | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function contentReleaseStateForResponse(
  action: ExamGatewayAction,
  rawBody: string,
): ContentReleaseState {
  let payload: JsonObject | null = null;
  try {
    payload = asJsonObject(JSON.parse(rawBody) as unknown);
  } catch {
    return 'invalid';
  }
  if (!payload) return 'invalid';

  let container: JsonObject | null = null;
  if (action === 'create' || action === 'bootstrap' || action === 'reviewBootstrap') {
    container = asJsonObject(payload.session);
  } else if (
    action === 'window' ||
    action === 'reviewWindow' ||
    action === 'feedback' ||
    action === 'trainingFeedback' ||
    action === 'reviewFeedback'
  ) {
    container = payload;
  } else if (action === 'submit') {
    container = asJsonObject(payload.feedback);
  }

  if (!container || !Object.prototype.hasOwnProperty.call(container, 'content_release_id')) {
    return 'invalid';
  }
  const releaseId = container.content_release_id;
  if (releaseId === null) return 'legacy';
  if (typeof releaseId === 'string' && RELEASE_ID_PATTERN.test(releaseId)) return 'pinned';
  return 'invalid';
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
  return (
    error instanceof ExamRequestBudgetError ||
    (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
  );
}

function remainingBudgetMs(deadline: number, capMs = Number.POSITIVE_INFINITY): number {
  const remaining = Math.floor(deadline - performance.now());
  if (remaining <= 0) throw new ExamRequestBudgetError();
  return Math.max(1, Math.min(remaining, capMs));
}

async function withinRequestBudget<T>(
  deadline: number,
  task: () => Promise<T>,
  capMs = Number.POSITIVE_INFINITY,
): Promise<T> {
  const timeoutMs = remainingBudgetMs(deadline, capMs);
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      task(),
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ExamRequestBudgetError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function requestTimeoutResponse(): Response {
  return jsonError(504, 'EXAM_REQUEST_TIMEOUT', 'Exam request took too long to complete.');
}

async function recordRateLimitRejection(options: {
  supabaseUrl: string;
  publishableKey: string;
  accessToken: string;
  proof: GatewayProof;
  action: ExamGatewayAction;
  requestDeadline: number;
}) {
  try {
    const timeoutMs = remainingBudgetMs(options.requestDeadline, RATE_LIMIT_RECORD_TIMEOUT_MS);
    await fetch(
      `${options.supabaseUrl}/rest/v1/rpc/record_exam_gateway_rate_limit_rejection`,
      {
        method: 'POST',
        cache: 'no-store',
        headers: gatewayHeaders(options.publishableKey, options.accessToken, options.proof),
        body: JSON.stringify({ p_action: options.action }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
  } catch {
    // The request is already rejected by Vercel. Abuse accounting remains best-effort.
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
    const rawBody = await withinRequestBudget(requestDeadline, () => request.text());
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return jsonError(413, 'REQUEST_TOO_LARGE', 'Request is too large.');
    }
    rawRequestBody = JSON.parse(rawBody) as unknown;
  } catch (error) {
    if (isTimeoutError(error)) return requestTimeoutResponse();
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
    db: { retry: false },
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

  let claimsData;
  let claimsError;
  try {
    const result = await withinRequestBudget(requestDeadline, () =>
      PINNED_SUPABASE_JWKS.kind === 'ready'
        ? authClient.auth.getClaims(accessToken, { jwks: PINNED_SUPABASE_JWKS.jwks })
        : authClient.auth.getClaims(accessToken),
    );
    claimsData = result.data;
    claimsError = result.error;
  } catch (error) {
    if (isTimeoutError(error)) return requestTimeoutResponse();
    return jsonError(401, 'INVALID_AUTH_TOKEN', 'Authentication token is invalid.');
  }

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
    return jsonError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your password before continuing.');
  }
  authMs = performance.now() - authStart;

  const validateAuthoritativeUser = async (): Promise<Response | null> => {
    const currentUserStart = performance.now();
    try {
      const {
        data: { user },
        error,
      } = await withinRequestBudget(requestDeadline, () => authClient.auth.getUser(accessToken));
      authMs += performance.now() - currentUserStart;

      if (error || !user || user.id !== userId) {
        return jsonError(401, 'INVALID_AUTH_TOKEN', 'Authentication token is invalid.');
      }
      if (user.app_metadata?.must_change_password === true) {
        return jsonError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your password before continuing.');
      }
      return null;
    } catch (error) {
      authMs += performance.now() - currentUserStart;
      if (isTimeoutError(error)) return requestTimeoutResponse();
      return jsonError(401, 'INVALID_AUTH_TOKEN', 'Authentication token is invalid.');
    }
  };

  if (windowAccessPresented && !windowAction) {
    const authError = await validateAuthoritativeUser();
    if (authError) return authError;
  }

  const proof = buildGatewayProof({ request, gatewayKeyId, gatewayKey, riskHmacSecret });
  const rateLimitStart = performance.now();

  if (rateLimitEnabled) {
    try {
      const { rateLimited, error: rateLimitError } = await withinRequestBudget(
        requestDeadline,
        () => checkVercelRateLimit(rateLimitId, { request, rateLimitKey: userId }),
      );

      if (rateLimitError) {
        if (!RATE_LIMIT_FAIL_OPEN_ACTIONS.has(body.action)) {
          return jsonError(503, 'EXAM_RATE_LIMIT_UNAVAILABLE', 'Exam service is temporarily unavailable.');
        }
      } else if (rateLimited) {
        await recordRateLimitRejection({
          supabaseUrl,
          publishableKey,
          accessToken,
          proof,
          action: body.action,
          requestDeadline,
        });
        return jsonError(
          429,
          'RATE_LIMITED',
          'Too many requests. Try again shortly.',
          RATE_LIMIT_RETRY_AFTER_SECONDS,
        );
      }
    } catch (error) {
      if (isTimeoutError(error)) return requestTimeoutResponse();
      if (!RATE_LIMIT_FAIL_OPEN_ACTIONS.has(body.action)) {
        return jsonError(503, 'EXAM_RATE_LIMIT_UNAVAILABLE', 'Exam service is temporarily unavailable.');
      }
    }
  }
  rateLimitMs = performance.now() - rateLimitStart;

  const r2ContentEnabled = isExamR2ContentEnabled();
  if (r2ContentEnabled && windowAction) {
    const fastPathStart = performance.now();
    let fastPathBody: string | null = null;
    try {
      fastPathBody = await withinRequestBudget(requestDeadline, () =>
        trySignedExamWindowFastPath({
          request,
          action: body.action,
          args: body.args,
          userId,
          secret: riskHmacSecret,
        }),
      );
    } catch (error) {
      if (isTimeoutError(error)) return requestTimeoutResponse();
    }
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

    if (windowAccessPresented) {
      const authError = await validateAuthoritativeUser();
      if (authError) return authError;
    }
  }

  const legacyRpcName = EXAM_RPC_BY_ACTION[body.action];
  const r2RpcName = r2ContentEnabled ? r2RpcNameForAction(body.action) : null;
  const primaryRpcName = r2RpcName || legacyRpcName;
  let rpcArgs: Record<string, unknown> = body.args;

  if (r2ContentEnabled && RELEASE_PIN_ACTIONS.has(body.action)) {
    let activeRelease = null;
    try {
      activeRelease = await withinRequestBudget(
        requestDeadline,
        () => resolveActiveExamContentRelease(),
        ACTIVE_RELEASE_LOOKUP_CAP_MS,
      );
    } catch (error) {
      if (isTimeoutError(error)) return requestTimeoutResponse();
    }

    if (!activeRelease) {
      return jsonError(503, 'EXAM_CONTENT_UNAVAILABLE', 'Exam content is temporarily unavailable.');
    }
    rpcArgs = {
      ...body.args,
      p_content_release_id: activeRelease.releaseId,
    };
  }

  const callRpc = (rpcName: string, args: Record<string, unknown> = rpcArgs) => {
    const timeoutMs = remainingBudgetMs(requestDeadline, EXAM_UPSTREAM_TIMEOUT_MS);
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
    if (isTimeoutError(error)) return requestTimeoutResponse();
    return jsonError(502, 'EXAM_UPSTREAM_UNAVAILABLE', 'Exam service is temporarily unavailable.');
  }
  upstreamFetchMs += performance.now() - upstreamFetchStart;

  const responseReadStart = performance.now();
  let rawResponseBody: string;
  try {
    rawResponseBody = await withinRequestBudget(requestDeadline, () => upstream.text());
  } catch (error) {
    if (isTimeoutError(error)) return requestTimeoutResponse();
    return jsonError(502, 'EXAM_UPSTREAM_UNAVAILABLE', 'Exam service is temporarily unavailable.');
  }
  responseReadMs = performance.now() - responseReadStart;

  if (r2RpcName && upstream.ok) {
    const releaseState = contentReleaseStateForResponse(body.action, rawResponseBody);
    let hydratedBody: string | null = null;
    try {
      hydratedBody = await withinRequestBudget(
        requestDeadline,
        () => hydrateExamR2Response(body.action, rawResponseBody),
      );
    } catch (error) {
      // submit may already be committed. Never turn an R2 timeout after mutation
      // into a replay requirement; acknowledge persistence with feedback pending.
      if (isTimeoutError(error) && body.action !== 'submit') return requestTimeoutResponse();
    }

    if (hydratedBody != null) {
      rawResponseBody = hydratedBody;
    } else if (releaseState === 'legacy' && body.action !== 'create') {
      // Explicitly unpinned sessions predate release pinning. They intentionally
      // keep the proven live Postgres path until completion. This branch is never
      // available to a pinned session, so immutable generations cannot be mixed.
      if (body.action === 'submit') {
        let submitResult: JsonObject | null = null;
        try {
          submitResult = asJsonObject(JSON.parse(rawResponseBody) as unknown);
        } catch {
          submitResult = null;
        }

        const sessionId = body.args.p_session_id;
        const questionId = body.args.p_question_id;
        if (
          !submitResult ||
          !asJsonObject(submitResult.answer) ||
          typeof sessionId !== 'string' ||
          typeof questionId !== 'number'
        ) {
          return jsonError(503, 'EXAM_CONTENT_UNAVAILABLE', 'Exam content is temporarily unavailable.');
        }

        const feedbackFetchStart = performance.now();
        try {
          const feedbackResponse = await callRpc(EXAM_RPC_BY_ACTION.feedback, {
            p_session_id: sessionId,
            p_question_id: questionId,
          });
          upstreamFetchMs += performance.now() - feedbackFetchStart;

          const feedbackReadStart = performance.now();
          const feedbackBody = await withinRequestBudget(requestDeadline, () => feedbackResponse.text());
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
      } else {
        const fallbackFetchStart = performance.now();
        try {
          upstream = await callRpc(legacyRpcName, body.args);
        } catch (error) {
          if (isTimeoutError(error)) return requestTimeoutResponse();
          return jsonError(502, 'EXAM_UPSTREAM_UNAVAILABLE', 'Exam service is temporarily unavailable.');
        }
        upstreamFetchMs += performance.now() - fallbackFetchStart;

        const fallbackReadStart = performance.now();
        try {
          rawResponseBody = await withinRequestBudget(requestDeadline, () => upstream.text());
        } catch (error) {
          if (isTimeoutError(error)) return requestTimeoutResponse();
          return jsonError(502, 'EXAM_UPSTREAM_UNAVAILABLE', 'Exam service is temporarily unavailable.');
        }
        responseReadMs += performance.now() - fallbackReadStart;
      }
    } else if (body.action === 'submit') {
      // A pinned mutation already committed. Never replay it or read correctness
      // from live content; the client retries feedback against the same release.
      let submitResult: JsonObject | null = null;
      try {
        submitResult = asJsonObject(JSON.parse(rawResponseBody) as unknown);
      } catch {
        submitResult = null;
      }
      if (submitResult && asJsonObject(submitResult.answer)) {
        rawResponseBody = JSON.stringify({
          ...submitResult,
          feedback: null,
          feedback_pending: true,
        });
      } else {
        return jsonError(503, 'EXAM_CONTENT_UNAVAILABLE', 'Exam content is temporarily unavailable.');
      }
    } else {
      return jsonError(503, 'EXAM_CONTENT_UNAVAILABLE', 'Exam content is temporarily unavailable.');
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

  return new Response(responseBody, { status: upstream.status, headers });
}
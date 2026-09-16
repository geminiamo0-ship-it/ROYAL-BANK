import { logExamClientMetric } from '@/lib/exam-client-diagnostics';
import type { ExamGatewayAction, ExamGatewayArgsByAction } from '@/types/exam-gateway';

export const EXAM_RATE_LIMIT_EVENT = 'royal:exam-rate-limit';
export const EXAM_RATE_LIMIT_STORAGE_KEY = 'royal.exam-rate-limit-until';

const EXAM_WINDOW_ACCESS_HEADER = 'x-royal-window-access';
const DEFAULT_CLIENT_TIMEOUT_MS = 10_000;
const EXAM_GATEWAY_ENDPOINT =
  process.env.NEXT_PUBLIC_ROYAL_EXAM_EDGE_ENABLED === 'true' ? '/api/exam-edge' : '/api/exam';

type GatewayErrorInfo = {
  message: string;
  code: string | null;
};

type ExamGatewayCallOptions = {
  windowAccessToken?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export class ExamGatewayError extends Error {
  code: string | null;
  status: number;
  retryAfterSeconds: number | null;

  constructor(
    message: string,
    options: {
      code?: string | null;
      status: number;
      retryAfterSeconds?: number | null;
    }
  ) {
    super(message);
    this.name = 'ExamGatewayError';
    this.code = options.code ?? null;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

function extractGatewayError(payload: unknown, fallback: string): GatewayErrorInfo {
  if (!payload || typeof payload !== 'object') {
    return { message: fallback, code: null };
  }

  const record = payload as Record<string, unknown>;
  const topLevelCode = typeof record.code === 'string' && record.code ? record.code : null;

  if (typeof record.message === 'string' && record.message) {
    return { message: record.message, code: topLevelCode };
  }

  if (record.error && typeof record.error === 'object') {
    const error = record.error as Record<string, unknown>;
    const nestedCode = typeof error.code === 'string' && error.code ? error.code : null;

    if (typeof error.message === 'string' && error.message) {
      return { message: error.message, code: nestedCode ?? topLevelCode };
    }

    if (nestedCode) {
      return { message: nestedCode, code: nestedCode };
    }
  }

  if (topLevelCode) return { message: topLevelCode, code: topLevelCode };
  return { message: fallback, code: null };
}

function parseRetryAfterSeconds(value: string | null): number | null {
  if (!value) return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.max(1, Math.ceil(numeric));
  }

  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) return null;

  const seconds = Math.ceil((retryAt - Date.now()) / 1000);
  return seconds > 0 ? seconds : null;
}

function publishRateLimitCountdown(retryAfterSeconds: number): void {
  if (typeof window === 'undefined') return;

  const now = Date.now();
  const candidateRetryAt = now + Math.max(1, retryAfterSeconds) * 1000;
  let retryAt = candidateRetryAt;

  try {
    const storedRetryAt = Number(window.sessionStorage.getItem(EXAM_RATE_LIMIT_STORAGE_KEY) || 0);
    if (Number.isFinite(storedRetryAt) && storedRetryAt > now) {
      retryAt = storedRetryAt;
    } else {
      window.sessionStorage.setItem(EXAM_RATE_LIMIT_STORAGE_KEY, String(retryAt));
    }
  } catch {
    // The countdown is a UX aid only; storage failures must never affect exam security.
  }

  window.dispatchEvent(
    new CustomEvent(EXAM_RATE_LIMIT_EVENT, {
      detail: { retryAt },
    })
  );
}

function gatewaySignal(options?: ExamGatewayCallOptions): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeoutMs = Math.max(250, Math.floor(options?.timeoutMs ?? DEFAULT_CLIENT_TIMEOUT_MS));
  const timeoutId = window.setTimeout(() => controller.abort('timeout'), timeoutMs);

  const abortFromCaller = () => controller.abort(options?.signal?.reason);
  if (options?.signal) {
    if (options.signal.aborted) abortFromCaller();
    else options.signal.addEventListener('abort', abortFromCaller, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timeoutId);
      options?.signal?.removeEventListener('abort', abortFromCaller);
    },
  };
}

export async function callExamGateway<T, A extends ExamGatewayAction>(
  action: A,
  args: ExamGatewayArgsByAction[A],
  options?: ExamGatewayCallOptions,
): Promise<T> {
  const startedAt = performance.now();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (options?.windowAccessToken) {
    headers[EXAM_WINDOW_ACCESS_HEADER] = options.windowAccessToken;
  }

  const { signal, cleanup } = gatewaySignal(options);
  let response: Response;
  try {
    response = await fetch(EXAM_GATEWAY_ENDPOINT, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify({ action, args }),
      signal,
    });
  } catch (error) {
    logExamClientMetric('gateway', {
      action,
      ok: false,
      status: 0,
      duration_ms: Number((performance.now() - startedAt).toFixed(1)),
      aborted: signal.aborted,
    });
    if (signal.aborted) {
      const aborted = new Error(options?.signal?.aborted ? 'Exam request was cancelled.' : 'Exam request timed out.');
      aborted.name = options?.signal?.aborted ? 'AbortError' : 'TimeoutError';
      throw aborted;
    }
    throw error;
  } finally {
    cleanup();
  }

  const rawBody = await response.text();
  logExamClientMetric('gateway', {
    action,
    ok: response.ok,
    status: response.status,
    duration_ms: Number((performance.now() - startedAt).toFixed(1)),
    request_id: response.headers.get('x-royal-request-id'),
    server_timing: response.headers.get('server-timing'),
  });

  let payload: unknown = null;

  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const errorInfo = extractGatewayError(
      payload,
      `Exam request failed (${response.status}).`
    );

    if (response.status === 429) {
      const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get('retry-after')) ?? 60;
      publishRateLimitCountdown(retryAfterSeconds);

      throw new ExamGatewayError(
        'Request limit reached. Please wait for the countdown before trying again.',
        {
          code: errorInfo.code ?? 'RATE_LIMITED',
          status: response.status,
          retryAfterSeconds,
        }
      );
    }

    throw new ExamGatewayError(errorInfo.message, {
      code: errorInfo.code,
      status: response.status,
    });
  }

  return payload as T;
}

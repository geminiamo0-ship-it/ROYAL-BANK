import { userCanAccessBank, verifySupabaseAccessToken } from './auth';
import { parseGatewayRequest } from './contracts';
import { handleDeepDiveEntitlementAdmin, handleDeepDiveRequest } from './deep-dive-router';
import type { ExamSyncEvent } from './env';
import { syncExamEventsToSupabase } from './sync';
export { UserExamState } from './user-exam-state';
export { DeepDiveUserState } from './deep-dive-user-state';
export { DeepDiveCache } from './deep-dive-cache';

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'x-royal-gateway': 'cloudflare-v2',
    },
  });
}

function addExamTiming(
  response: Response,
  values: {
    jwtVerifyMs: number;
    bankAccessMs: number;
    durableObjectMs: number;
    totalMs: number;
    doPhases?: Record<string, number>;
  },
): Response {
  const timings = [
    `jwt_verify;dur=${values.jwtVerifyMs.toFixed(2)}`,
    `bank_access;dur=${values.bankAccessMs.toFixed(2)}`,
    `durable_object;dur=${values.durableObjectMs.toFixed(2)}`,
    `total;dur=${values.totalMs.toFixed(2)}`,
  ];
  for (const [name, duration] of Object.entries(values.doPhases || {})) {
    if (/^do_[a-z_]+$/.test(name) && Number.isFinite(duration) && duration >= 0) {
      timings.push(`${name};dur=${duration.toFixed(2)}`);
    }
  }
  response.headers.set('server-timing', timings.join(', '));
  response.headers.set('x-royal-timing-version', '2');
  return response;
}

function bearer(request: Request): string | null {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice(7).trim();
  return token || null;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const requestStarted = performance.now();
    let jwtVerifyMs = 0;
    let bankAccessMs = 0;
    let durableObjectMs = 0;

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({
        ok: true,
        service: env.SERVICE_NAME || 'royal-bank-exam',
        environment: env.APP_ENV,
        supabase_project_ref: env.SUPABASE_PROJECT_REF,
      });
    }
    const isExamRequest = request.method === 'POST' && url.pathname === '/exam';
    const isDeepDiveRequest = request.method === 'POST' && url.pathname === '/deep-dive';
    const isDeepDiveAdminRequest =
      request.method === 'POST' && url.pathname === '/deep-dive/admin/entitlement';
    if (!isExamRequest && !isDeepDiveRequest && !isDeepDiveAdminRequest) {
      return json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404);
    }

    const token = bearer(request);
    if (!token) return json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } }, 401);

    let userId: string;
    const jwtStarted = performance.now();
    try {
      userId = (await verifySupabaseAccessToken(env, token)).userId;
      jwtVerifyMs = performance.now() - jwtStarted;
    } catch {
      return json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } }, 401);
    }

    if (isDeepDiveRequest) {
      return handleDeepDiveRequest(request, env, userId, ctx);
    }
    if (isDeepDiveAdminRequest) {
      return handleDeepDiveEntitlementAdmin(request, env, userId);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request.' } }, 400);
    }
    const parsed = parseGatewayRequest(body);
    if (!parsed) return json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request.' } }, 400);
    const timedAction = parsed.action === 'create' || parsed.action === 'prepare';

    let bankAccessGranted: boolean | undefined;
    if (parsed.action === 'prepare') {
      const accessStarted = performance.now();
      bankAccessGranted = await userCanAccessBank(env, token, Number(parsed.args.p_bank_id));
      bankAccessMs = performance.now() - accessStarted;
      if (!bankAccessGranted) {
        return addExamTiming(
          json({ error: { code: 'QUESTION_BANK_ACCESS_DENIED', message: 'Question bank access denied.' } }, 403),
          {
            jwtVerifyMs,
            bankAccessMs,
            durableObjectMs,
            totalMs: performance.now() - requestStarted,
          },
        );
      }
    }

    const stub = env.USER_EXAMS.getByName(userId);
    const callDurableObject = async (granted: boolean | undefined): Promise<unknown> => {
      const started = performance.now();
      try {
        return await stub.handle({
          userId,
          action: parsed.action,
          args: parsed.args,
          bankAccessGranted: granted,
        });
      } finally {
        durableObjectMs += performance.now() - started;
      }
    };

    const errorResponse = (error: unknown): Response => {
      const record = error as { code?: unknown; status?: unknown; message?: unknown; overloaded?: unknown };
      if (record.overloaded === true) {
        const response = json({ error: { code: 'EDGE_OVERLOADED', message: 'Exam service is busy.' } }, 503);
        return timedAction
          ? addExamTiming(response, {
              jwtVerifyMs,
              bankAccessMs,
              durableObjectMs,
              totalMs: performance.now() - requestStarted,
            })
          : response;
      }
      const code = typeof record.code === 'string' ? record.code : 'EXAM_REQUEST_FAILED';
      const status = typeof record.status === 'number' && record.status >= 400 && record.status <= 599 ? record.status : 500;
      const safeMessage = status < 500 && typeof record.message === 'string' ? record.message : 'Exam request failed.';
      if (status >= 500) {
        console.error('EXAM_GATEWAY_SERVER_ERROR', {
          action: parsed.action,
          code,
          error_name: error instanceof Error ? error.name : typeof error,
          error_message: error instanceof Error ? error.message : typeof record.message === 'string' ? record.message : 'unknown',
        });
      }
      const response = json({ error: { code, message: safeMessage } }, status);
      return timedAction
        ? addExamTiming(response, {
            jwtVerifyMs,
            bankAccessMs,
            durableObjectMs,
            totalMs: performance.now() - requestStarted,
          })
        : response;
    };

    let result: unknown;
    try {
      result = await callDurableObject(bankAccessGranted);
    } catch (error) {
      const record = error as { code?: unknown };
      if (parsed.action === 'create' && record.code === 'QUESTION_BANK_ACCESS_REVALIDATION_REQUIRED') {
        const accessStarted = performance.now();
        const granted = await userCanAccessBank(env, token, Number(parsed.args.p_bank_id));
        bankAccessMs += performance.now() - accessStarted;
        if (!granted) {
          return addExamTiming(
            json({ error: { code: 'QUESTION_BANK_ACCESS_DENIED', message: 'Question bank access denied.' } }, 403),
            {
              jwtVerifyMs,
              bankAccessMs,
              durableObjectMs,
              totalMs: performance.now() - requestStarted,
            },
          );
        }
        try {
          result = await callDurableObject(true);
        } catch (retryError) {
          return errorResponse(retryError);
        }
      } else {
        return errorResponse(error);
      }
    }

    let doPhases: Record<string, number> | undefined;
    if (timedAction && result && typeof result === 'object' && !Array.isArray(result)) {
      const record = result as Record<string, unknown>;
      const rawTiming = record.__edge_timing;
      if (rawTiming && typeof rawTiming === 'object' && !Array.isArray(rawTiming)) {
        doPhases = Object.fromEntries(
          Object.entries(rawTiming as Record<string, unknown>)
            .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
            .map(([name, value]) => [name, Number(value)]),
        );
      }
      delete record.__edge_timing;

      if (parsed.action === 'prepare' && typeof doPhases?.do_prepare_total === 'number') {
        doPhases.do_dispatch_overhead = Math.max(0, durableObjectMs - doPhases.do_prepare_total);
      }
    }

    const response = json(result);
    return timedAction
      ? addExamTiming(response, {
          jwtVerifyMs,
          bankAccessMs,
          durableObjectMs,
          totalMs: performance.now() - requestStarted,
          doPhases,
        })
      : response;
  },

  async queue(batch: MessageBatch<ExamSyncEvent>, env: Env): Promise<void> {
    if (batch.queue !== env.EXAM_SYNC_QUEUE_NAME) {
      console.error('Unexpected queue delivered to exam worker', batch.queue);
      batch.retryAll({ delaySeconds: 30 });
      return;
    }

    try {
      await syncExamEventsToSupabase(env, batch.messages.map((message) => message.body));
      batch.ackAll();
    } catch (error) {
      const attempts = Math.max(1, ...batch.messages.map((message) => message.attempts));
      const delaySeconds = Math.min(300, Math.max(5, 2 ** Math.min(attempts, 8)));
      console.error('Exam sync batch failed', error);
      batch.retryAll({ delaySeconds });
    }
  },
} satisfies ExportedHandler<Env, ExamSyncEvent>;

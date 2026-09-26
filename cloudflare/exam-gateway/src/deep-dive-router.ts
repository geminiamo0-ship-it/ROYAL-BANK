import { normalizedSupabaseUrl } from './auth';
import {
  buildDeepDiveCacheKey,
  detectDeepDiveLanguage,
  effectiveDeepDivePromptVersion,
  generateDeepDiveFollowUp,
  type DeepDiveChatMessage,
  type DeepDiveLanguage,
} from './deep-dive';
import type { ExamSyncEvent } from './env';

type DeepDiveStartBody = {
  action: 'start';
  sessionId: string;
  questionId: number;
  language: DeepDiveLanguage;
};

type DeepDiveMessageBody = {
  action: 'message';
  threadId: string;
  requestId: string;
  message: string;
};

type DeepDiveBody = DeepDiveStartBody | DeepDiveMessageBody;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'x-royal-deep-dive': 'v2',
    },
  });
}

function parseBody(value: unknown): DeepDiveBody | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (body.action === 'start') {
    if (
      typeof body.sessionId === 'string'
      && UUID_RE.test(body.sessionId)
      && typeof body.questionId === 'number'
      && Number.isSafeInteger(body.questionId)
      && body.questionId > 0
    ) {
      const language: DeepDiveLanguage = body.language === 'ar' ? 'ar' : 'en';
      return {
        action: 'start',
        sessionId: body.sessionId,
        questionId: Number(body.questionId),
        language,
      };
    }
    return null;
  }

  if (body.action === 'message') {
    if (
      typeof body.threadId === 'string'
      && UUID_RE.test(body.threadId)
      && typeof body.requestId === 'string'
      && UUID_RE.test(body.requestId)
      && typeof body.message === 'string'
      && body.message.trim().length > 0
      && body.message.trim().length <= 2_000
    ) {
      return {
        action: 'message',
        threadId: body.threadId,
        requestId: body.requestId,
        message: body.message.trim(),
      };
    }
  }

  return null;
}

function errorStatus(code: string): number {
  if (code === 'DEEP_DIVE_DAILY_LIMIT' || code === 'DEEP_DIVE_FOLLOWUP_LIMIT') return 429;
  if (code === 'DEEP_DIVE_THREAD_NOT_FOUND') return 404;
  if (code === 'FEEDBACK_LOCKED') return 403;
  if (code === 'QUESTION_NOT_ANSWERED' || code === 'DEEP_DIVE_THREAD_NOT_READY' || code === 'DEEP_DIVE_MESSAGE_PENDING') return 409;
  if (
    code === 'QUESTION_NOT_IN_SESSION'
    || code === 'DEEP_DIVE_INVALID_MESSAGE'
    || code === 'DEEP_DIVE_REQUEST_ID_REUSED'
  ) return 400;
  return 500;
}

function safeError(error: unknown): Response {
  const record = error as { code?: unknown; status?: unknown; message?: unknown };
  const code = typeof record.code === 'string' ? record.code : 'DEEP_DIVE_FAILED';
  const status = typeof record.status === 'number' ? record.status : errorStatus(code);
  const safeMessage = status < 500 && typeof record.message === 'string'
    ? record.message
    : 'Deep Dive is temporarily unavailable.';
  if (status >= 500) {
    console.error('DEEP_DIVE_ERROR', {
      code,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return json({ error: { code, message: safeMessage } }, status);
}

async function deepDiveConfig(env: Env) {
  return env.DEEP_DIVE_CONFIG.getByName('global').getConfig();
}

function queueUsage(
  ctx: ExecutionContext,
  env: Env,
  event: ExamSyncEvent,
): void {
  ctx.waitUntil(
    env.EXAM_SYNC_QUEUE.send(event).catch((error) => {
      console.error('DEEP_DIVE_USAGE_QUEUE_FAILED', error);
    }),
  );
}

export async function handleDeepDiveRequest(
  request: Request,
  env: Env,
  userId: string,
  ctx: ExecutionContext,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request.' } }, 400);
  }

  const body = parseBody(raw);
  if (!body) return json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request.' } }, 400);

  const config = await deepDiveConfig(env);
  const userState = env.DEEP_DIVE_USERS.getByName(userId);
  const examState = env.USER_EXAMS.getByName(userId);

  if (body.action === 'start') {
    try {
      const context = await examState.getDeepDiveContext({
        userId,
        sessionId: body.sessionId,
        questionId: body.questionId,
      });
      const computedCacheKey = await buildDeepDiveCacheKey(context, config, body.language);
      const promptVersion = effectiveDeepDivePromptVersion(config);

      const prepared = await userState.prepareStart({
        userId,
        sessionId: body.sessionId,
        questionId: body.questionId,
        selectedOptionId: context.selectedOptionId,
        cacheKey: computedCacheKey,
        language: body.language,
        defaultDailyLimit: config.dailyLimit,
        defaultFollowupLimit: config.followupLimit,
      }) as Record<string, unknown>;

      if (prepared.ok !== true) {
        const code = typeof prepared.code === 'string' ? prepared.code : 'DEEP_DIVE_FAILED';
        return json({
          error: {
            code,
            message: code === 'DEEP_DIVE_DAILY_LIMIT'
              ? 'You have used today\'s Deep Dives.'
              : 'Deep Dive is unavailable.',
          },
          remaining: Number(prepared.remaining ?? 0),
          dailyLimit: Number(prepared.dailyLimit ?? config.dailyLimit),
          followupLimit: Number(prepared.followupLimit ?? config.followupLimit),
        }, errorStatus(code));
      }

      const threadId = String(prepared.threadId);
      const initialResponse = typeof prepared.initialResponse === 'string'
        ? prepared.initialResponse
        : '';
      if (initialResponse) {
        return json({
          ok: true,
          threadId,
          initialResponse,
          messages: Array.isArray(prepared.messages) ? prepared.messages : [],
          model: prepared.model ?? null,
          promptVersion: prepared.promptVersion ?? null,
          cacheHit: true,
          existingThread: true,
          remaining: Number(prepared.remaining ?? 0),
          dailyLimit: Number(prepared.dailyLimit ?? config.dailyLimit),
          followupLimit: Number(prepared.followupLimit ?? config.followupLimit),
          remainingFollowups: Number(prepared.remainingFollowups ?? config.followupLimit),
          language: body.language,
        });
      }

      const cacheKey = typeof prepared.cacheKey === 'string' ? prepared.cacheKey : computedCacheKey;
      const cacheState = env.DEEP_DIVE_CACHE.getByName(cacheKey);
      const reserved = prepared.reserved === true;

      try {
        const generated = await cacheState.getOrGenerate({
          cacheKey,
          context,
          config,
          language: body.language,
        });

        await userState.finalizeStart({
          userId,
          threadId,
          language: body.language,
          cacheKey,
          content: generated.generation.content,
          model: generated.generation.model,
          promptVersion,
        });

        queueUsage(ctx, env, {
          event_id: crypto.randomUUID(),
          user_id: userId,
          session_id: body.sessionId,
          stream_version: 0,
          event_type: 'ai.deep_dive.started',
          payload: {
            thread_id: threadId,
            question_id: body.questionId,
            selected_option_id: context.selectedOptionId,
            model: generated.generation.model,
            prompt_version: promptVersion,
            language: body.language,
            cache_hit: generated.cacheHit,
            input_tokens: generated.cacheHit ? 0 : generated.generation.inputTokens,
            output_tokens: generated.cacheHit ? 0 : generated.generation.outputTokens,
            cost_usd: generated.cacheHit ? 0 : generated.generation.costUsd,
            latency_ms: generated.generation.latencyMs,
          },
          occurred_at: new Date().toISOString(),
        });

        return json({
          ok: true,
          threadId,
          initialResponse: generated.generation.content,
          messages: [],
          model: generated.generation.model,
          promptVersion,
          language: body.language,
          cacheHit: generated.cacheHit,
          existingThread: prepared.existing === true,
          remaining: Number(prepared.remaining ?? 0),
          dailyLimit: Number(prepared.dailyLimit ?? config.dailyLimit),
          followupLimit: Number(prepared.followupLimit ?? config.followupLimit),
          remainingFollowups: Number(prepared.remainingFollowups ?? config.followupLimit),
        });
      } catch (error) {
        if (reserved) {
          await userState.refundStart({ userId, threadId }).catch(() => undefined);
        }
        throw error;
      }
    } catch (error) {
      return safeError(error);
    }
  }

  try {
    const prepared = await userState.prepareMessage({
      userId,
      threadId: body.threadId,
      requestId: body.requestId,
      message: body.message,
      defaultDailyLimit: config.dailyLimit,
      defaultFollowupLimit: config.followupLimit,
    }) as Record<string, unknown>;

    if (prepared.ok !== true) {
      const code = typeof prepared.code === 'string' ? prepared.code : 'DEEP_DIVE_FAILED';
      return json({
        error: {
          code,
          message: code === 'DEEP_DIVE_FOLLOWUP_LIMIT'
            ? 'This Deep Dive conversation has reached its follow-up limit.'
            : code === 'DEEP_DIVE_MESSAGE_PENDING'
              ? 'This message is already being processed.'
              : 'Unable to continue this Deep Dive.',
        },
        remainingFollowups: Number(prepared.remainingFollowups ?? 0),
        followupLimit: Number(prepared.followupLimit ?? config.followupLimit),
      }, errorStatus(code));
    }

    if (prepared.idempotent === true && typeof prepared.assistantResponse === 'string') {
      return json({
        ok: true,
        threadId: body.threadId,
        assistantResponse: prepared.assistantResponse,
        model: prepared.model ?? null,
        idempotent: true,
        remainingFollowups: prepared.remainingFollowups ?? null,
      });
    }

    const sessionId = String(prepared.sessionId);
    const questionId = Number(prepared.questionId);
    const initialResponse = String(prepared.initialResponse || '');
    const history = Array.isArray(prepared.history)
      ? prepared.history.filter((item): item is DeepDiveChatMessage => (
          Boolean(item)
          && typeof item === 'object'
          && !Array.isArray(item)
          && (((item as { role?: unknown }).role === 'user') || ((item as { role?: unknown }).role === 'assistant'))
          && typeof (item as { content?: unknown }).content === 'string'
        ))
      : [];

    const context = await examState.getDeepDiveContext({
      userId,
      sessionId,
      questionId,
    });

    try {
      const responseLanguage = detectDeepDiveLanguage(body.message);
      const generation = await generateDeepDiveFollowUp(
        env,
        context,
        initialResponse,
        history,
        body.message,
        config,
      );

      await userState.commitMessage({
        userId,
        threadId: body.threadId,
        requestId: body.requestId,
        message: body.message,
        assistantResponse: generation.content,
        model: generation.model,
        inputTokens: generation.inputTokens,
        outputTokens: generation.outputTokens,
        latencyMs: generation.latencyMs,
      });

      queueUsage(ctx, env, {
        event_id: crypto.randomUUID(),
        user_id: userId,
        session_id: sessionId,
        stream_version: 0,
        event_type: 'ai.deep_dive.message',
        payload: {
          thread_id: body.threadId,
          question_id: questionId,
          model: generation.model,
          prompt_version: effectiveDeepDivePromptVersion(config),
          language: responseLanguage,
          cache_hit: false,
          input_tokens: generation.inputTokens,
          output_tokens: generation.outputTokens,
          cost_usd: generation.costUsd,
          latency_ms: generation.latencyMs,
        },
        occurred_at: new Date().toISOString(),
      });

      return json({
        ok: true,
        threadId: body.threadId,
        assistantResponse: generation.content,
        model: generation.model,
        language: responseLanguage,
        idempotent: false,
        remainingFollowups: Number(prepared.remainingFollowups ?? 0),
        followupLimit: Number(prepared.followupLimit ?? config.followupLimit),
      });
    } catch (error) {
      await userState.failMessage({ userId, requestId: body.requestId }).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    return safeError(error);
  }
}

async function actorCanManageAi(env: Env, actorId: string): Promise<boolean> {
  const secret = env.SUPABASE_SECRET_KEY?.trim();
  if (!secret) return false;
  const url = new URL('/rest/v1/profiles', normalizedSupabaseUrl(env));
  url.searchParams.set('id', `eq.${actorId}`);
  url.searchParams.set('select', 'role,is_active');
  url.searchParams.set('limit', '1');

  const response = await fetch(url, {
    headers: {
      apikey: secret,
      authorization: `Bearer ${secret}`,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) return false;
  const rows = await response.json<Array<{ role?: string; is_active?: boolean }>>();
  return rows[0]?.is_active === true && (rows[0]?.role === 'admin' || rows[0]?.role === 'support');
}

export async function handleDeepDiveEntitlementAdmin(
  request: Request,
  env: Env,
  actorId: string,
): Promise<Response> {
  if (!(await actorCanManageAi(env, actorId))) {
    return json({ error: { code: 'ADMIN_ACCESS_REQUIRED', message: 'Support access is required.' } }, 403);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request.' } }, 400);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request.' } }, 400);
  }

  const body = raw as Record<string, unknown>;
  const action =
    body.action === 'get'
      ? 'get'
      : body.action === 'clear'
        ? 'clear'
        : body.action === 'set' || body.action == null
          ? 'set'
          : null;
  const targetUserId = typeof body.userId === 'string' ? body.userId : '';
  if (!action || !UUID_RE.test(targetUserId)) {
    return json({ error: { code: 'INVALID_REQUEST', message: 'Choose a valid AI allowance request.' } }, 400);
  }

  if (action === 'get') {
    const config = await deepDiveConfig(env);
    const snapshot = await env.DEEP_DIVE_USERS.getByName(targetUserId).adminSnapshot({
      userId: targetUserId,
      defaultDailyLimit: config.dailyLimit,
      defaultFollowupLimit: config.followupLimit,
    });
    return json(snapshot);
  }

  const secret = env.SUPABASE_SECRET_KEY?.trim();
  if (!secret) {
    return json({ error: { code: 'AI_ADMIN_NOT_CONFIGURED', message: 'AI admin service is unavailable.' } }, 503);
  }
  const base = normalizedSupabaseUrl(env);

  if (action === 'clear') {
    const deleteResponse = await fetch(
      `${base}/rest/v1/ai_user_entitlements?user_id=eq.${encodeURIComponent(targetUserId)}`,
      {
        method: 'DELETE',
        headers: {
          apikey: secret,
          authorization: `Bearer ${secret}`,
          prefer: 'return=minimal',
        },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!deleteResponse.ok) {
      console.error('DEEP_DIVE_ENTITLEMENT_CLEAR_DB_FAILED', await deleteResponse.text());
      return json({ error: { code: 'AI_ENTITLEMENT_SAVE_FAILED', message: 'Unable to clear AI allowance.' } }, 502);
    }

    await env.DEEP_DIVE_USERS.getByName(targetUserId).clearEntitlement({ userId: targetUserId });

    const auditResponse = await fetch(`${base}/rest/v1/ai_entitlement_audit`, {
      method: 'POST',
      headers: {
        apikey: secret,
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
        prefer: 'return=minimal',
      },
      body: JSON.stringify({
        user_id: targetUserId,
        actor_user_id: actorId,
        daily_limit: 0,
        followup_limit: 0,
        expires_at: null,
        reason: typeof body.reason === 'string' && body.reason.trim()
          ? `Override cleared: ${body.reason.trim().slice(0, 450)}`
          : 'Override cleared',
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!auditResponse.ok) {
      console.error('DEEP_DIVE_ENTITLEMENT_CLEAR_AUDIT_FAILED', await auditResponse.text());
    }

    const config = await deepDiveConfig(env);
    return json(await env.DEEP_DIVE_USERS.getByName(targetUserId).adminSnapshot({
      userId: targetUserId,
      defaultDailyLimit: config.dailyLimit,
      defaultFollowupLimit: config.followupLimit,
    }));
  }

  const dailyLimit = Number(body.dailyLimit);
  const followupLimit = Number(body.followupLimit);
  const expiresAt = body.expiresAt == null || body.expiresAt === '' ? null : String(body.expiresAt);
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';

  if (
    !Number.isSafeInteger(dailyLimit)
    || dailyLimit < 1
    || dailyLimit > 1000
    || !Number.isSafeInteger(followupLimit)
    || followupLimit < 1
    || followupLimit > 200
  ) {
    return json({ error: { code: 'INVALID_REQUEST', message: 'Choose valid AI limits.' } }, 400);
  }

  let expiresAtMs: number | null = null;
  let expiresAtIso: string | null = null;
  if (expiresAt) {
    expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      return json({ error: { code: 'INVALID_REQUEST', message: 'Choose a future override expiry.' } }, 400);
    }
    expiresAtIso = new Date(expiresAtMs).toISOString();
  }

  const entitlementResponse = await fetch(
    `${base}/rest/v1/ai_user_entitlements?on_conflict=user_id`,
    {
      method: 'POST',
      headers: {
        apikey: secret,
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
        accept: 'application/json',
        prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify({
        user_id: targetUserId,
        daily_limit_override: dailyLimit,
        followup_limit_override: followupLimit,
        override_expires_at: expiresAtIso,
        updated_by: actorId,
        updated_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (!entitlementResponse.ok) {
    console.error('DEEP_DIVE_ENTITLEMENT_DB_FAILED', await entitlementResponse.text());
    return json({ error: { code: 'AI_ENTITLEMENT_SAVE_FAILED', message: 'Unable to save AI allowance.' } }, 502);
  }

  const auditResponse = await fetch(`${base}/rest/v1/ai_entitlement_audit`, {
    method: 'POST',
    headers: {
      apikey: secret,
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
      prefer: 'return=minimal',
    },
    body: JSON.stringify({
      user_id: targetUserId,
      actor_user_id: actorId,
      daily_limit: dailyLimit,
      followup_limit: followupLimit,
      expires_at: expiresAtIso,
      reason: reason || null,
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!auditResponse.ok) {
    console.error('DEEP_DIVE_ENTITLEMENT_AUDIT_FAILED', await auditResponse.text());
  }

  await env.DEEP_DIVE_USERS.getByName(targetUserId).setEntitlement({
    userId: targetUserId,
    dailyLimit,
    followupLimit,
    expiresAtMs,
  });

  return json({
    ok: true,
    userId: targetUserId,
    dailyLimit,
    followupLimit,
    expiresAt: expiresAtIso,
  });
}

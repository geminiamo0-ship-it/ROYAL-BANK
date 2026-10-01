import { getRoyalAiConfig, type RoyalAiConfig } from './config';
import type { RoyalAiEnv, RoyalAiUsageEvent } from './env';
import { buildRuntimePrompt, type RoyalAiLanguage } from './prompt';
import { openRouterStream, summarizeConversation } from './openrouter';
import { retrieveRoyalKnowledge, type RoyalAiSource } from './retrieval';

const encoder = new TextEncoder();

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'x-royal-ai': 'cloudflare-v1',
    },
  });
}

function statusFor(code: string): number {
  if (code === 'ROYAL_AI_DAILY_LIMIT') return 429;
  if (code === 'ROYAL_AI_CONVERSATION_NOT_FOUND') return 404;
  if (code === 'ROYAL_AI_MESSAGE_PENDING' || code === 'ROYAL_AI_REQUEST_ID_REUSED') return 409;
  return 400;
}

function sse(event: string, payload: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

async function writeSafely(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  chunk: Uint8Array,
): Promise<boolean> {
  try {
    await writer.write(chunk);
    return true;
  } catch {
    return false;
  }
}

function sourceCards(sources: RoyalAiSource[]) {
  return sources.map((source) => ({
    id: source.id,
    title: source.title,
    articleId: source.articleId,
    bankId: source.bankId,
    score: source.score,
  }));
}

function recentMessages(value: unknown): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as { role?: unknown; content?: unknown };
    if ((row.role !== 'user' && row.role !== 'assistant') || typeof row.content !== 'string') return [];
    return [{ role: row.role, content: row.content }];
  });
}

export async function handleRoyalAiChat(
  request: Request,
  env: RoyalAiEnv,
  userId: string,
  ctx: ExecutionContext,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json<Record<string, unknown>>();
  } catch {
    return json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request.' } }, 400);
  }

  const action = String(body.action || '');
  const config = await getRoyalAiConfig(env);
  const stub = env.ROYAL_AI_USERS.getByName(userId);

  if (action !== 'message') {
    const mapped: Record<string, string> = {
      list: 'listConversations',
      get: 'getConversation',
      new: 'newConversation',
      delete: 'deleteConversation',
      delete_all: 'deleteAllConversations',
      usage: 'usage',
      preferences: 'getPreferences',
      set_language: 'setLanguage',
    };
    const doAction = mapped[action];
    if (!doAction) {
      return json({ error: { code: 'INVALID_ACTION', message: 'Unsupported Royal AI action.' } }, 400);
    }
    const result = await stub.handle({
      userId,
      action: doAction,
      conversationId: body.conversationId,
      language: body.language,
      defaultDailyLimit: config.dailyLimit,
    });
    return json(result);
  }

  const requestId = String(body.requestId || '');
  const message = String(body.message || '');
  const language: RoyalAiLanguage = body.language === 'ar' ? 'ar' : 'en';
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : null;

  const prepared = await stub.handle({
    userId,
    action: 'prepareMessage',
    requestId,
    message,
    language,
    conversationId,
    defaultDailyLimit: config.dailyLimit,
    maxMessageChars: config.maxMessageChars,
  }) as Record<string, unknown>;

  if (prepared.ok !== true) {
    const code = String(prepared.code || 'ROYAL_AI_REQUEST_FAILED');
    return json({
      error: {
        code,
        message:
          code === 'ROYAL_AI_DAILY_LIMIT'
            ? 'You have used today\'s Royal AI messages.'
            : code === 'ROYAL_AI_MESSAGE_PENDING'
              ? 'Royal is already answering this conversation.'
              : code === 'ROYAL_AI_CONVERSATION_NOT_FOUND'
                ? 'Conversation not found.'
                : 'Unable to send this message.',
      },
      dailyLimit: prepared.dailyLimit,
      remainingToday: prepared.remainingToday,
      dayKey: prepared.dayKey,
    }, statusFor(code));
  }

  if (prepared.idempotent === true && typeof prepared.assistantResponse === 'string') {
    return replayResponse(ctx, prepared);
  }

  const history = recentMessages(prepared.recentMessages);
  const retrieval = await retrieveRoyalKnowledge(env, { message, recentMessages: history, config });
  const groundingMode: 'royal' | 'general' = retrieval.sources.length > 0 ? 'royal' : 'general';
  const prompt = buildRuntimePrompt({
    language,
    groundingMode,
    conversationSummary: String(prepared.summary || ''),
    recentMessages: history,
    sources: retrieval.sources,
    message,
  });

  let upstream: Awaited<ReturnType<typeof openRouterStream>>;
  const totalStarted = performance.now();
  try {
    upstream = await openRouterStream(env, prompt, config);
  } catch (error) {
    try { await stub.handle({ userId, action: 'failMessage', requestId }); } catch {}
    console.error('ROYAL_AI_OPENROUTER_START_FAILED', error);
    return json({ error: { code: 'ROYAL_AI_UNAVAILABLE', message: 'Royal AI is temporarily unavailable.' } }, 502);
  }

  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const cards = sourceCards(retrieval.sources);

  ctx.waitUntil(processModelStream({
    env,
    ctx,
    userId,
    requestId,
    config,
    stub,
    prepared,
    upstream,
    retrievalMs: retrieval.retrievalMs,
    groundingMode,
    sources: cards,
    writer,
    totalStarted,
  }));

  return new Response(stream.readable, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-store',
      'x-accel-buffering': 'no',
      'x-royal-ai': 'cloudflare-v1',
    },
  });
}

function replayResponse(ctx: ExecutionContext, prepared: Record<string, unknown>): Response {
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  ctx.waitUntil((async () => {
    await writeSafely(writer, sse('meta', {
      conversationId: prepared.conversationId,
      remainingToday: prepared.remainingToday,
      dailyLimit: prepared.dailyLimit,
      groundingMode: prepared.groundingMode || 'general',
      sources: prepared.sources || [],
      replay: true,
    }));
    await writeSafely(writer, sse('token', { text: prepared.assistantResponse }));
    await writeSafely(writer, sse('done', { ok: true, replay: true }));
    try { await writer.close(); } catch {}
  })());
  return new Response(stream.readable, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-store',
      'x-accel-buffering': 'no',
      'x-royal-ai': 'cloudflare-v1',
    },
  });
}

async function processModelStream(input: {
  env: RoyalAiEnv;
  ctx: ExecutionContext;
  userId: string;
  requestId: string;
  config: RoyalAiConfig;
  stub: DurableObjectStub<import('./user-state').RoyalAiUserState>;
  prepared: Record<string, unknown>;
  upstream: Awaited<ReturnType<typeof openRouterStream>>;
  retrievalMs: number;
  groundingMode: 'royal' | 'general';
  sources: Array<{ id: string; title: string; articleId: string | null; bankId: number | null; score: number }>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  totalStarted: number;
}): Promise<void> {
  const {
    env, ctx, userId, requestId, config, stub, prepared, upstream,
    retrievalMs, groundingMode, sources, writer, totalStarted,
  } = input;

  let clientOpen = await writeSafely(writer, sse('meta', {
    conversationId: prepared.conversationId,
    remainingToday: prepared.remainingToday,
    dailyLimit: prepared.dailyLimit,
    groundingMode,
    sources,
    sourceNotice: groundingMode === 'royal'
      ? 'Grounded in Royal sources'
      : 'General medical knowledge — no matching Royal source found',
  }));

  let responseText = '';
  let buffer = '';
  let model = upstream.requestedModel;
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let firstTokenMs = 0;
  const generationStarted = performance.now();

  try {
    const reader = upstream.response.body!.pipeThrough(new TextDecoderStream()).getReader();

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const events = buffer.split(/\n\n/);
      buffer = events.pop() || '';

      for (const rawEvent of events) {
        const data = rawEvent
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n');
        if (!data || data === '[DONE]') continue;

        let payload: Record<string, unknown>;
        try { payload = JSON.parse(data) as Record<string, unknown>; } catch { continue; }

        if (typeof payload.model === 'string' && payload.model) model = payload.model;

        const choices = Array.isArray(payload.choices) ? payload.choices : [];
        const choice = choices[0] as { delta?: { content?: unknown } } | undefined;
        const token = typeof choice?.delta?.content === 'string' ? choice.delta.content : '';
        if (token) {
          responseText += token;
          if (!firstTokenMs) firstTokenMs = performance.now() - totalStarted;
          if (clientOpen) clientOpen = await writeSafely(writer, sse('token', { text: token }));
        }

        const usage = payload.usage && typeof payload.usage === 'object'
          ? payload.usage as Record<string, unknown>
          : null;
        if (usage) {
          inputTokens = Number(usage.prompt_tokens || inputTokens || 0);
          outputTokens = Number(usage.completion_tokens || outputTokens || 0);
          costUsd = Number(usage.cost || costUsd || 0);
        }
      }
    }

    if (!responseText.trim()) throw new Error('ROYAL_AI_EMPTY_STREAM');

    const generationMs = performance.now() - generationStarted;
    const totalMs = performance.now() - totalStarted;
    const committed = await stub.handle({
      userId,
      action: 'commitMessage',
      requestId,
      assistantResponse: responseText,
      sources,
      groundingMode,
      model,
      inputTokens,
      outputTokens,
      costUsd,
      retrievalMs,
      firstTokenMs,
      generationMs,
      totalMs,
    }) as Record<string, unknown>;

    const usageEvent: RoyalAiUsageEvent = {
      eventId: crypto.randomUUID(),
      userId,
      conversationId: String(prepared.conversationId || ''),
      requestId,
      model,
      promptVersion: config.promptVersion,
      groundingMode,
      sourceCount: sources.length,
      inputTokens,
      outputTokens,
      costUsd,
      retrievalMs,
      firstTokenMs,
      generationMs,
      totalMs,
      createdAt: new Date().toISOString(),
    };
    await env.ROYAL_AI_SYNC_QUEUE.send(usageEvent).catch((error: unknown) => {
      console.error('ROYAL_AI_USAGE_QUEUE_FAILED', error);
    });

    if (committed.summaryDue === true) {
      ctx.waitUntil(refreshSummary(env, stub, userId, String(prepared.conversationId || ''), config));
    }

    if (clientOpen) {
      await writeSafely(writer, sse('done', { ok: true, model, inputTokens, outputTokens, costUsd }));
    }
  } catch (error) {
    console.error('ROYAL_AI_STREAM_FAILED', error);
    try { await stub.handle({ userId, action: 'failMessage', requestId }); } catch {}
    if (clientOpen) {
      await writeSafely(writer, sse('error', {
        code: 'ROYAL_AI_STREAM_FAILED',
        message: 'Royal AI response was interrupted. Your message allowance was restored.',
      }));
    }
  } finally {
    try { await writer.close(); } catch {}
  }
}

async function refreshSummary(
  env: RoyalAiEnv,
  stub: DurableObjectStub<import('./user-state').RoyalAiUserState>,
  userId: string,
  conversationId: string,
  config: RoyalAiConfig,
): Promise<void> {
  try {
    const state = await stub.handle({ userId, action: 'getSummaryContext', conversationId }) as Record<string, unknown>;
    if (state.ok !== true || !Array.isArray(state.messages)) return;
    const messages = (state.messages as Array<Record<string, unknown>>).flatMap((item) =>
      typeof item.role === 'string' && typeof item.content === 'string'
        ? [{ role: item.role, content: item.content }]
        : [],
    );
    const summary = await summarizeConversation(env, {
      config,
      previousSummary: String(state.summary || ''),
      messages,
    });
    if (summary) await stub.handle({ userId, action: 'setSummary', conversationId, summary });
  } catch (error) {
    console.error('ROYAL_AI_SUMMARY_REFRESH_FAILED', error);
  }
}

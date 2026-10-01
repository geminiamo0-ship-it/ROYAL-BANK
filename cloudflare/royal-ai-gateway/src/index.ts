import { verifySupabaseAccessToken } from './auth';
import { handleRoyalAiEntitlementAdmin } from './admin';
import { handleRoyalAiChat } from './chat';
import type { RoyalAiEnv, RoyalAiUsageEvent } from './env';
import { syncRoyalAiUsage } from './sync';
export { RoyalAiUserState } from './user-state';

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

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

export default {
  async fetch(request: Request, env: RoyalAiEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({
        ok: true,
        service: env.SERVICE_NAME || 'royal-ai',
        environment: env.APP_ENV,
        aiSearchInstance: env.AI_SEARCH_INSTANCE,
        openRouterConfigured: Boolean(env.OPENROUTER_API_KEY?.trim()),
        version: 1,
      });
    }

    const isChat = request.method === 'POST' && url.pathname === '/chat';
    const isAdmin = request.method === 'POST' && url.pathname === '/admin/entitlement';
    if (!isChat && !isAdmin) {
      return json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404);
    }

    const token = bearer(request);
    if (!token) {
      return json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } }, 401);
    }

    let userId: string;
    try {
      userId = (await verifySupabaseAccessToken(env, token)).userId;
    } catch {
      return json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } }, 401);
    }

    return isAdmin
      ? handleRoyalAiEntitlementAdmin(request, env, userId)
      : handleRoyalAiChat(request, env, userId, ctx);
  },

  async queue(batch: MessageBatch<RoyalAiUsageEvent>, env: RoyalAiEnv): Promise<void> {
    if (batch.queue !== env.ROYAL_AI_SYNC_QUEUE_NAME) {
      console.error('ROYAL_AI_UNEXPECTED_QUEUE', batch.queue);
      batch.retryAll({ delaySeconds: 30 });
      return;
    }

    try {
      await syncRoyalAiUsage(env, batch.messages.map((message) => message.body));
      batch.ackAll();
    } catch (error) {
      console.error('ROYAL_AI_USAGE_SYNC_BATCH_FAILED', error);
      const attempts = Math.max(1, ...batch.messages.map((message) => message.attempts));
      batch.retryAll({
        delaySeconds: Math.min(300, Math.max(5, 2 ** Math.min(attempts, 8))),
      });
    }
  },
} satisfies ExportedHandler<RoyalAiEnv, RoyalAiUsageEvent>;

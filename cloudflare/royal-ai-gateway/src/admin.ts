import { getRoyalAiConfig } from './config';
import type { RoyalAiEnv } from './env';
import { normalizedSupabaseUrl, requireSupportRole } from './auth';

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

async function persistOverride(
  env: RoyalAiEnv,
  input: {
    actorId: string;
    userId: string;
    dailyLimit: number;
    expiresAt: string | null;
    reason: string;
  },
): Promise<void> {
  const base = normalizedSupabaseUrl(env);
  const expiresAt = input.expiresAt ? new Date(input.expiresAt).toISOString() : null;

  const response = await fetch(
    base + '/rest/v1/ai_royal_tutor_entitlements?on_conflict=user_id',
    {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SECRET_KEY,
        authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY,
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        user_id: input.userId,
        daily_limit: input.dailyLimit,
        expires_at: expiresAt,
        updated_by: input.actorId,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  if (!response.ok) throw new Error('ROYAL_AI_ENTITLEMENT_PERSIST_FAILED');

  await fetch(base + '/rest/v1/ai_royal_tutor_entitlement_audit', {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY,
      'content-type': 'application/json',
      prefer: 'return=minimal',
    },
    body: JSON.stringify({
      user_id: input.userId,
      actor_id: input.actorId,
      action: 'set',
      daily_limit: input.dailyLimit,
      expires_at: expiresAt,
      reason: input.reason,
    }),
  }).catch(() => undefined);
}

async function clearOverride(
  env: RoyalAiEnv,
  actorId: string,
  userId: string,
  reason: string,
): Promise<void> {
  const base = normalizedSupabaseUrl(env);
  const response = await fetch(
    base + '/rest/v1/ai_royal_tutor_entitlements?user_id=eq.' + encodeURIComponent(userId),
    {
      method: 'DELETE',
      headers: {
        apikey: env.SUPABASE_SECRET_KEY,
        authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY,
        prefer: 'return=minimal',
      },
    },
  );
  if (!response.ok) throw new Error('ROYAL_AI_ENTITLEMENT_CLEAR_FAILED');

  await fetch(base + '/rest/v1/ai_royal_tutor_entitlement_audit', {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY,
      'content-type': 'application/json',
      prefer: 'return=minimal',
    },
    body: JSON.stringify({
      user_id: userId,
      actor_id: actorId,
      action: 'clear',
      reason,
    }),
  }).catch(() => undefined);
}

async function hydrateOverride(
  env: RoyalAiEnv,
  userId: string,
  stub: DurableObjectStub<import('./user-state').RoyalAiUserState>,
  defaultDailyLimit: number,
): Promise<void> {
  const url = new URL(normalizedSupabaseUrl(env) + '/rest/v1/ai_royal_tutor_entitlements');
  url.searchParams.set('user_id', 'eq.' + userId);
  url.searchParams.set('select', 'daily_limit,expires_at');
  url.searchParams.set('limit', '1');

  const response = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY,
      accept: 'application/json',
    },
  });
  if (!response.ok) return;
  const rows = await response.json<Array<{ daily_limit?: number; expires_at?: string | null }>>();
  const row = rows[0];
  const dailyLimit = Number(row?.daily_limit);
  const expiresAtMs = row?.expires_at ? new Date(row.expires_at).getTime() : null;
  const valid =
    !!row &&
    Number.isSafeInteger(dailyLimit) &&
    dailyLimit >= 1 &&
    (expiresAtMs == null || (Number.isFinite(expiresAtMs) && expiresAtMs > Date.now()));

  if (!valid) {
    await stub.handle({
      userId,
      action: 'clearEntitlement',
      defaultDailyLimit,
    });
    return;
  }

  await stub.handle({
    userId,
    action: 'setEntitlement',
    dailyLimit,
    expiresAtMs,
  });
}

export async function handleRoyalAiEntitlementAdmin(
  request: Request,
  env: RoyalAiEnv,
  actorId: string,
): Promise<Response> {
  try {
    await requireSupportRole(env, actorId);
  } catch {
    return json({ error: { code: 'FORBIDDEN', message: 'Support access is required.' } }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json<Record<string, unknown>>();
  } catch {
    return json({ error: { code: 'INVALID_REQUEST', message: 'Invalid request.' } }, 400);
  }

  const action = String(body.action || '');
  const userId = String(body.userId || '');
  if (!/^[0-9a-f-]{30,40}$/i.test(userId)) {
    return json({ error: { code: 'INVALID_USER', message: 'Invalid user.' } }, 400);
  }

  const config = await getRoyalAiConfig(env);
  const stub = env.ROYAL_AI_USERS.getByName(userId);

  if (action === 'get') {
    await hydrateOverride(env, userId, stub, config.dailyLimit);
    return json(await stub.handle({
      userId,
      action: 'getSupportSnapshot',
      defaultDailyLimit: config.dailyLimit,
    }));
  }

  if (action === 'set') {
    const dailyLimit = Number(body.dailyLimit);
    const expiresAt =
      typeof body.expiresAt === 'string' && body.expiresAt.trim()
        ? body.expiresAt.trim()
        : null;
    const reason = String(body.reason || 'Support allowance change').slice(0, 500);
    const expiresAtMs = expiresAt ? new Date(expiresAt).getTime() : null;

    if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 1000) {
      return json({ error: { code: 'INVALID_LIMIT', message: 'Daily messages must be between 1 and 1000.' } }, 400);
    }
    if (expiresAt && (!Number.isFinite(expiresAtMs) || Number(expiresAtMs) <= Date.now())) {
      return json({ error: { code: 'INVALID_EXPIRY', message: 'Choose a future expiry.' } }, 400);
    }

    await persistOverride(env, { actorId, userId, dailyLimit, expiresAt, reason });
    await stub.handle({ userId, action: 'setEntitlement', dailyLimit, expiresAtMs });
    return json(await stub.handle({
      userId,
      action: 'getSupportSnapshot',
      defaultDailyLimit: config.dailyLimit,
    }));
  }

  if (action === 'clear') {
    const reason = String(body.reason || 'Support reset to default').slice(0, 500);
    await clearOverride(env, actorId, userId, reason);
    await stub.handle({ userId, action: 'clearEntitlement', defaultDailyLimit: config.dailyLimit });
    return json(await stub.handle({
      userId,
      action: 'getSupportSnapshot',
      defaultDailyLimit: config.dailyLimit,
    }));
  }

  return json({ error: { code: 'INVALID_ACTION', message: 'Unsupported allowance action.' } }, 400);
}

'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export type DeepDiveAdminOverview = {
  from: string;
  to: string;
  config: {
    primary_model: string;
    fallback_model: string | null;
    temperature: number | string;
    max_initial_tokens: number;
    max_followup_tokens: number;
    prompt_version: string;
    timeout_ms: number;
    default_daily_limit: number;
    default_followup_limit: number;
    updated_at: string;
  };
  usage: {
    requests: number | string;
    deep_dive_starts: number | string;
    followup_messages: number | string;
    active_users: number | string;
    cache_hits: number | string;
    cache_hit_rate_percent: number | string;
    input_tokens: number | string;
    output_tokens: number | string;
    cost_usd: number | string;
    avg_latency_ms: number | string;
  };
  models: Array<{
    model: string;
    requests: number | string;
    input_tokens: number | string;
    output_tokens: number | string;
    cost_usd: number | string;
  }>;
};

export type DeepDiveAdminResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const modelSlug = z
  .string()
  .trim()
  .min(3)
  .max(180)
  .regex(/^[A-Za-z0-9._:-]+\/[A-Za-z0-9._:+-]+$/, 'Use a valid OpenRouter model slug.');

const configSchema = z.object({
  primaryModel: modelSlug,
  fallbackModel: z.union([modelSlug, z.literal('')]).optional(),
  temperature: z.number().min(0).max(1),
  maxInitialTokens: z.number().int().min(300).max(4000),
  maxFollowupTokens: z.number().int().min(200).max(2500),
  timeoutMs: z.number().int().min(5000).max(55000),
  defaultDailyLimit: z.number().int().min(1).max(100),
  defaultFollowupLimit: z.number().int().min(1).max(100),
}).strict();

async function requireAdminActor(): Promise<
  | { ok: true; actorId: string }
  | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, error: 'Please sign in again.' };

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role,is_active')
    .eq('id', user.id)
    .single();

  if (error || !profile?.is_active || profile.role !== 'admin') {
    return { ok: false, error: 'Admin access is required.' };
  }

  return { ok: true, actorId: user.id };
}

export async function getDeepDiveAdminOverview(
  days = 30,
): Promise<DeepDiveAdminResult<DeepDiveAdminOverview>> {
  const actor = await requireAdminActor();
  if (!actor.ok) return actor;

  const safeDays = Math.min(90, Math.max(1, Math.round(Number(days) || 30)));
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: 'The secure AI admin service is not configured.' };
  }

  const from = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin.rpc('admin_get_deep_dive_ai_overview', {
    p_from: from,
  });

  if (error || !data) {
    return { ok: false, error: 'Unable to load Deep Dive AI analytics.' };
  }
  return { ok: true, data: data as DeepDiveAdminOverview };
}

export async function updateDeepDiveAdminConfig(
  input: unknown,
): Promise<DeepDiveAdminResult<{ updatedAt: string }>> {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || 'Invalid AI configuration.' };
  }

  const actor = await requireAdminActor();
  if (!actor.ok) return actor;

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: 'The secure AI admin service is not configured.' };
  }

  const updatedAt = new Date().toISOString();
  const value = parsed.data;
  const { error } = await admin
    .from('ai_deep_dive_config')
    .update({
      primary_model: value.primaryModel,
      fallback_model: value.fallbackModel?.trim() || null,
      temperature: value.temperature,
      max_initial_tokens: value.maxInitialTokens,
      max_followup_tokens: value.maxFollowupTokens,
      timeout_ms: value.timeoutMs,
      default_daily_limit: value.defaultDailyLimit,
      default_followup_limit: value.defaultFollowupLimit,
      updated_at: updatedAt,
    })
    .eq('active', true);

  if (error) {
    return { ok: false, error: 'Unable to update the Deep Dive AI configuration.' };
  }

  revalidatePath('/admin/deep-dive');
  return { ok: true, data: { updatedAt } };
}

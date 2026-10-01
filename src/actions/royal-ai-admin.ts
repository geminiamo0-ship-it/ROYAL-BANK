'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

export type RoyalAiAdminOverview = {
  from: string;
  to: string;
  config: {
    primary_model: string;
    fallback_model: string | null;
    temperature: number | string;
    max_output_tokens: number;
    prompt_version: string;
    timeout_ms: number;
    default_daily_limit: number;
    max_message_chars: number;
    retrieval_candidates: number;
    retrieval_final: number;
    updated_at: string;
  };
  usage: {
    messages: number | string;
    active_users: number | string;
    royal_grounded: number | string;
    general_fallback: number | string;
    grounded_rate_percent: number | string;
    input_tokens: number | string;
    output_tokens: number | string;
    cost_usd: number | string;
    avg_retrieval_ms: number | string;
    avg_first_token_ms: number | string;
    avg_total_ms: number | string;
  };
  models: Array<{
    model: string;
    requests: number | string;
    input_tokens: number | string;
    output_tokens: number | string;
    cost_usd: number | string;
  }>;
};

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const modelSlug = z.string().trim().min(3).max(180)
  .regex(/^[A-Za-z0-9._:-]+\/[A-Za-z0-9._:+-]+$/, 'Use a valid OpenRouter model slug.');

const configSchema = z.object({
  primaryModel: modelSlug,
  fallbackModel: z.union([modelSlug, z.literal('')]).optional(),
  temperature: z.number().min(0).max(1),
  maxOutputTokens: z.number().int().min(300).max(4000),
  timeoutMs: z.number().int().min(5000).max(170000),
  defaultDailyLimit: z.number().int().min(1).max(1000),
  maxMessageChars: z.number().int().min(500).max(12000),
  retrievalCandidates: z.number().int().min(5).max(50),
  retrievalFinal: z.number().int().min(1).max(12),
}).strict().refine((value) => value.retrievalFinal <= value.retrievalCandidates, {
  message: 'Final retrieval count cannot exceed candidate count.',
});

async function requireAdmin(): Promise<Result<{ actorId: string }>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Please sign in again.' };

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role,is_active')
    .eq('id', user.id)
    .single();

  if (error || !profile?.is_active || profile.role !== 'admin') {
    return { ok: false, error: 'Admin access is required.' };
  }
  return { ok: true, data: { actorId: user.id } };
}

export async function getRoyalAiAdminOverview(days = 30): Promise<Result<RoyalAiAdminOverview>> {
  const actor = await requireAdmin();
  if (!actor.ok) return actor;
  const safeDays = Math.min(90, Math.max(1, Math.round(Number(days) || 30)));
  const from = new Date(Date.now() - safeDays * 86_400_000).toISOString();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_get_royal_ai_overview_session', { p_from: from });
  if (error || !data) return { ok: false, error: 'Unable to load Royal AI analytics.' };
  return { ok: true, data: data as RoyalAiAdminOverview };
}

export async function updateRoyalAiAdminConfig(input: unknown): Promise<Result<{ updatedAt: string }>> {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || 'Invalid Royal AI configuration.' };
  }
  const actor = await requireAdmin();
  if (!actor.ok) return actor;

  const value = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_update_royal_ai_config_session', {
    p_primary_model: value.primaryModel,
    p_fallback_model: value.fallbackModel?.trim() || '',
    p_temperature: value.temperature,
    p_max_output_tokens: value.maxOutputTokens,
    p_timeout_ms: value.timeoutMs,
    p_default_daily_limit: value.defaultDailyLimit,
    p_max_message_chars: value.maxMessageChars,
    p_retrieval_candidates: value.retrievalCandidates,
    p_retrieval_final: value.retrievalFinal,
  });

  if (error || !data) return { ok: false, error: 'Unable to update Royal AI configuration.' };

  const updatedAt = typeof data === 'object' && data && 'updated_at' in data
    ? String((data as { updated_at?: unknown }).updated_at || new Date().toISOString())
    : new Date().toISOString();

  revalidatePath('/admin/royal-ai');
  return { ok: true, data: { updatedAt } };
}

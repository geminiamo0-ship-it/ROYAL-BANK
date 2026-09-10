'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type {
  IntelligenceAlert,
  IntelligenceReport,
  ProductAnalytics,
  SecurityRisk,
  TrialAnalytics,
} from '@/types/admin-intelligence';

export type IntelligenceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const windowSchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  })
  .strict()
  .refine((value) => new Date(value.to) > new Date(value.from), {
    message: 'Choose a valid report window.',
  });

const ipActionSchema = z
  .object({
    ip: z.string().trim().min(3).max(64),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

const manualReviewSchema = z
  .object({
    userId: z.string().uuid(),
    required: z.boolean(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

const knownErrors: Array<[string, string]> = [
  ['ADMIN_ACCESS_REQUIRED', 'Admin access is required.'],
  ['INVALID_REPORT_WINDOW', 'Choose a valid report window.'],
  ['IP_REQUIRED', 'Enter a valid IP address.'],
  ['BLOCK_REASON_REQUIRED', 'Add a reason before blocking this IP.'],
  ['UNBLOCK_REASON_REQUIRED', 'Add a reason before unblocking this IP.'],
  ['IP_BLOCK_NOT_FOUND', 'This IP is not currently blocked.'],
  ['USER_NOT_FOUND', 'User account not found.'],
  ['REVIEW_STATE_REQUIRED', 'Choose a manual-review state.'],
  ['REVIEW_REASON_REQUIRED', 'Add a reason for the review change.'],
  ['invalid input syntax for type inet', 'Enter a valid IPv4 or IPv6 address.'],
];

function safeError(error: { message?: string } | null, fallback: string) {
  const message = error?.message || '';
  return knownErrors.find(([code]) => message.includes(code))?.[1] || fallback;
}

function invalid<T>(message: string): IntelligenceResult<T> {
  return { ok: false, error: message };
}

async function runWindowRpc<T>(
  functionName:
    | 'admin_get_trial_analytics'
    | 'admin_get_product_analytics'
    | 'admin_get_security_risk'
    | 'admin_get_intelligence_report',
  input: unknown,
  fallback: string,
): Promise<IntelligenceResult<T>> {
  const parsed = windowSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message || 'Invalid report window.');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(functionName, {
    p_from: parsed.data.from,
    p_to: parsed.data.to,
  });

  if (error || !data) return { ok: false, error: safeError(error, fallback) };
  return { ok: true, data: data as T };
}

export async function getAdminTrialAnalytics(input: unknown) {
  return runWindowRpc<TrialAnalytics>(
    'admin_get_trial_analytics',
    input,
    'Unable to load trial analytics.',
  );
}

export async function getAdminProductAnalytics(input: unknown) {
  return runWindowRpc<ProductAnalytics>(
    'admin_get_product_analytics',
    input,
    'Unable to load product analytics.',
  );
}

export async function getAdminSecurityRisk(input: unknown) {
  return runWindowRpc<SecurityRisk>(
    'admin_get_security_risk',
    input,
    'Unable to load security intelligence.',
  );
}

export async function getAdminIntelligenceReport(input: unknown) {
  return runWindowRpc<IntelligenceReport>(
    'admin_get_intelligence_report',
    input,
    'Unable to generate the intelligence report.',
  );
}

export async function getAdminIntelligenceAlerts(): Promise<IntelligenceResult<IntelligenceAlert[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_get_intelligence_alerts');
  if (error || !data) return { ok: false, error: safeError(error, 'Unable to load live alerts.') };
  return { ok: true, data: data as IntelligenceAlert[] };
}

export async function blockAdminIp(input: unknown): Promise<IntelligenceResult<{ id: number; ip_address: string; reason: string; blocked_at: string }>> {
  const parsed = ipActionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message || 'Invalid IP block request.');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_block_ip', {
    p_ip: parsed.data.ip,
    p_reason: parsed.data.reason,
  });
  if (error || !data) return { ok: false, error: safeError(error, 'Unable to block this IP.') };

  revalidatePath('/admin/security');
  revalidatePath('/admin/alerts');
  return { ok: true, data: data as { id: number; ip_address: string; reason: string; blocked_at: string } };
}

export async function unblockAdminIp(input: unknown): Promise<IntelligenceResult<{ id: number; ip_address: string; status: string }>> {
  const parsed = ipActionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message || 'Invalid IP unblock request.');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_unblock_ip', {
    p_ip: parsed.data.ip,
    p_reason: parsed.data.reason,
  });
  if (error || !data) return { ok: false, error: safeError(error, 'Unable to unblock this IP.') };

  revalidatePath('/admin/security');
  revalidatePath('/admin/alerts');
  return { ok: true, data: data as { id: number; ip_address: string; status: string } };
}

export async function setAdminManualReview(input: unknown): Promise<IntelligenceResult<{ user_id: string; manual_review_required: boolean; risk_score: number; updated_at: string }>> {
  const parsed = manualReviewSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message || 'Invalid manual-review change.');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_set_manual_review', {
    p_user_id: parsed.data.userId,
    p_required: parsed.data.required,
    p_reason: parsed.data.reason,
  });
  if (error || !data) return { ok: false, error: safeError(error, 'Unable to update manual review.') };

  revalidatePath('/admin/security');
  revalidatePath('/admin/alerts');
  revalidatePath(`/admin/users/${parsed.data.userId}`);
  return {
    ok: true,
    data: data as { user_id: string; manual_review_required: boolean; risk_score: number; updated_at: string },
  };
}

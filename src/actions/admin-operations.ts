'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type {
  AdminOperationsSummary,
  AdminSupportPerformance,
  AdminUserDetail,
  AdminUserListRow,
} from '@/types/admin-operations';

export type AdminOperationsResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const userIdSchema = z.string().uuid();
const roleSchema = z.enum(['student', 'support', 'admin']);
const scopeSchema = z.enum(['global', 'pathway', 'bank']);

const userListSchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    role: roleSchema.nullable().optional(),
    isActive: z.boolean().nullable().optional(),
    limit: z.number().int().min(1).max(250).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .strict();

const updateUserSchema = z
  .object({
    userId: userIdSchema,
    role: roleSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.role !== undefined || value.isActive !== undefined, {
    message: 'Choose an account change first.',
  });

const grantSchema = z
  .object({
    userId: userIdSchema,
    scopeType: scopeSchema,
    pathwayId: z.number().int().positive().nullable().optional(),
    bankId: z.number().int().positive().nullable().optional(),
    startsAt: z.string().datetime({ offset: true }).nullable().optional(),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.scopeType === 'global' && (value.pathwayId != null || value.bankId != null)) {
      ctx.addIssue({ code: 'custom', message: 'Global access cannot target a pathway or bank.' });
    }
    if (value.scopeType === 'pathway' && (value.pathwayId == null || value.bankId != null)) {
      ctx.addIssue({ code: 'custom', message: 'Choose a pathway for pathway access.' });
    }
    if (value.scopeType === 'bank' && (value.bankId == null || value.pathwayId != null)) {
      ctx.addIssue({ code: 'custom', message: 'Choose a question bank for bank access.' });
    }
    if (value.startsAt && value.expiresAt && new Date(value.expiresAt) <= new Date(value.startsAt)) {
      ctx.addIssue({ code: 'custom', message: 'Access expiry must be after its start date.' });
    }
  });

const extendSchema = z
  .object({
    grantId: z.number().int().positive(),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

const revokeSchema = z
  .object({
    grantId: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

const supportWindowSchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  })
  .strict();

const knownErrors: Array<[string, string]> = [
  ['ADMIN_ACCESS_REQUIRED', 'Admin access is required.'],
  ['USER_NOT_FOUND', 'User account not found.'],
  ['INVALID_USER_SEARCH', 'User search is too long.'],
  ['INVALID_USER_ROLE', 'Choose a valid user role.'],
  ['INVALID_SUBSCRIPTION_TIER', 'Choose a valid subscription tier.'],
  ['SUBSCRIPTION_TIER_IS_DERIVED', 'Subscription tier is display metadata only. Manage the authoritative access grant instead.'],
  ['ADMIN_SELF_LOCKOUT', 'You cannot demote or suspend your own administrator account.'],
  ['LAST_ADMIN_PROTECTED', 'The last active administrator account cannot be disabled.'],
  ['ACTIVE_SUBSCRIPTION_EXISTS', 'This user already has a live or scheduled Royal subscription. Revoke or expire it before creating another one.'],
  ['OPEN_UPGRADE_REQUEST_EXISTS', 'This user already has an open subscription request. Resolve or cancel it before changing the entitlement manually.'],
  ['ACCESS_ALREADY_ACTIVE', 'This user already has access covering that scope.'],
  ['ACCESS_GRANT_NOT_FOUND', 'Access grant not found.'],
  ['REVOKED_ACCESS_CANNOT_BE_EXTENDED', 'Revoked access cannot be extended.'],
  ['ACCESS_ALREADY_PERMANENT', 'This grant is already permanent.'],
  ['INVALID_ACCESS_EXTENSION', 'Choose an expiry later than the current expiry.'],
  ['REVOKE_REASON_REQUIRED', 'Add a reason before revoking access.'],
  ['INVALID_REPORT_WINDOW', 'Choose a valid report window.'],
  ['Invalid access scope', 'Choose a valid access scope.'],
  ['Invalid access time window', 'Choose a valid access time window.'],
];

function safeError(error: { message?: string } | null, fallback: string): string {
  const message = error?.message || '';
  return knownErrors.find(([code]) => message.includes(code))?.[1] || fallback;
}

function invalid<T>(message: string): AdminOperationsResult<T> {
  return { ok: false, error: message };
}

export async function listAdminUsers(
  input: unknown = {},
): Promise<AdminOperationsResult<AdminUserListRow[]>> {
  const parsed = userListSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message || 'Invalid user filter.');

  const value = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_list_users', {
    p_search: value.search || null,
    p_role: value.role ?? null,
    p_is_active: value.isActive ?? null,
    p_limit: value.limit ?? 100,
    p_offset: value.offset ?? 0,
  });

  if (error) return { ok: false, error: safeError(error, 'Unable to load users.') };
  return { ok: true, data: (data || []) as AdminUserListRow[] };
}

export async function getAdminUserDetail(
  userId: string,
): Promise<AdminOperationsResult<AdminUserDetail>> {
  const parsed = userIdSchema.safeParse(userId);
  if (!parsed.success) return invalid('Invalid user account.');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_get_user_detail', { p_user_id: parsed.data });
  if (error || !data) return { ok: false, error: safeError(error, 'Unable to load this user.') };
  return { ok: true, data: data as AdminUserDetail };
}

export async function updateAdminUserAccount(
  input: unknown,
): Promise<AdminOperationsResult<{ id: string; role: string; is_active: boolean }>> {
  const parsed = updateUserSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message || 'Invalid account change.');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_update_user_access', {
    p_user_id: parsed.data.userId,
    p_role: parsed.data.role ?? null,
    p_subscription_tier: null,
    p_is_active: parsed.data.isActive ?? null,
  });

  if (error || !data) return { ok: false, error: safeError(error, 'Unable to update this account.') };
  revalidatePath('/admin');
  revalidatePath('/admin/users');
  revalidatePath(`/admin/users/${parsed.data.userId}`);
  return { ok: true, data: data as { id: string; role: string; is_active: boolean } };
}

export async function grantAdminUserAccess(
  input: unknown,
): Promise<AdminOperationsResult<{ id: number; scope_type: string; status: string }>> {
  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message || 'Invalid access grant.');

  const value = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_grant_user_access', {
    p_user_id: value.userId,
    p_scope_type: value.scopeType,
    p_pathway_id: value.pathwayId ?? null,
    p_bank_id: value.bankId ?? null,
    p_starts_at: value.startsAt ?? new Date().toISOString(),
    p_expires_at: value.expiresAt ?? null,
  });

  if (error || !data) return { ok: false, error: safeError(error, 'Unable to grant access.') };
  revalidatePath('/admin');
  revalidatePath('/admin/users');
  revalidatePath(`/admin/users/${value.userId}`);
  return { ok: true, data: data as { id: number; scope_type: string; status: string } };
}

export async function extendAdminUserAccess(
  input: unknown,
  userIdForRefresh?: string,
): Promise<AdminOperationsResult<{ id: number; expires_at: string; status: string }>> {
  const parsed = extendSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message || 'Invalid access extension.');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_extend_user_access', {
    p_grant_id: parsed.data.grantId,
    p_expires_at: parsed.data.expiresAt,
  });

  if (error || !data) return { ok: false, error: safeError(error, 'Unable to extend access.') };
  revalidatePath('/admin');
  revalidatePath('/admin/users');
  if (userIdForRefresh && userIdSchema.safeParse(userIdForRefresh).success) {
    revalidatePath(`/admin/users/${userIdForRefresh}`);
  }
  return { ok: true, data: data as { id: number; expires_at: string; status: string } };
}

export async function revokeAdminUserAccess(
  input: unknown,
  userIdForRefresh?: string,
): Promise<AdminOperationsResult<{ id: number; revoked_at: string; revoke_reason: string; status: string }>> {
  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message || 'Invalid revocation.');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_revoke_user_access', {
    p_grant_id: parsed.data.grantId,
    p_reason: parsed.data.reason,
  });

  if (error || !data) return { ok: false, error: safeError(error, 'Unable to revoke access.') };
  revalidatePath('/admin');
  revalidatePath('/admin/users');
  if (userIdForRefresh && userIdSchema.safeParse(userIdForRefresh).success) {
    revalidatePath(`/admin/users/${userIdForRefresh}`);
  }
  return {
    ok: true,
    data: data as { id: number; revoked_at: string; revoke_reason: string; status: string },
  };
}

export async function getAdminOperationsSummary(): Promise<AdminOperationsResult<AdminOperationsSummary>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_get_operations_summary');
  if (error || !data) return { ok: false, error: safeError(error, 'Unable to load operations summary.') };
  return { ok: true, data: data as AdminOperationsSummary };
}

export async function getAdminSupportPerformance(
  input: unknown,
): Promise<AdminOperationsResult<AdminSupportPerformance>> {
  const parsed = supportWindowSchema.safeParse(input);
  if (!parsed.success) return invalid('Choose a valid report window.');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_get_support_performance', {
    p_from: parsed.data.from,
    p_to: parsed.data.to,
  });
  if (error || !data) return { ok: false, error: safeError(error, 'Unable to load support performance.') };
  return { ok: true, data: data as AdminSupportPerformance };
}

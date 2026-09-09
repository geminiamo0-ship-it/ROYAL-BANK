'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { BusinessActionResult } from '@/types/business';
import type {
  AdminCommissionRow,
  AdminPromoCodeRow,
  AdminRefundReceipt,
  AdminRevenueSummary,
  AdminSettlementReceipt,
  PartnerCouponSummary,
} from '@/types/business-admin';

const promoSchema = z
  .object({
    promoId: z.number().int().positive().nullable().optional(),
    code: z.string().trim().min(2).max(32).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
    ownerEmail: z.string().trim().email().nullable().optional(),
    status: z.enum(['active', 'inactive']),
    discountType: z.enum(['none', 'percentage', 'fixed', 'special_price']),
    discountValue: z.number().min(0).nullable(),
    discountCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).nullable(),
    commissionType: z.enum(['none', 'percentage', 'fixed']),
    commissionValue: z.number().min(0).nullable(),
    commissionCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).nullable(),
    commissionBasis: z.enum(['amount_paid', 'agreed_price']),
    validFrom: z.string().datetime({ offset: true }).nullable(),
    validUntil: z.string().datetime({ offset: true }).nullable(),
    maxActivations: z.number().int().positive().nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.discountType === 'none' && (value.discountValue !== null || value.discountCurrency !== null)) {
      ctx.addIssue({ code: 'custom', message: 'Tracking-only promos cannot have a customer discount.' });
    }
    if (value.discountType !== 'none' && value.discountValue === null) {
      ctx.addIssue({ code: 'custom', message: 'Discount value is required.' });
    }
    if (value.discountType === 'percentage' && (value.discountValue ?? 0) > 100) {
      ctx.addIssue({ code: 'custom', message: 'Percentage discount cannot exceed 100%.' });
    }
    if ((value.discountType === 'fixed' || value.discountType === 'special_price') && !value.discountCurrency) {
      ctx.addIssue({ code: 'custom', message: 'Discount currency is required.' });
    }
    if (value.commissionType === 'none' && (value.commissionValue !== null || value.commissionCurrency !== null)) {
      ctx.addIssue({ code: 'custom', message: 'A promo without commission cannot have commission values.' });
    }
    if (value.commissionType !== 'none' && value.commissionValue === null) {
      ctx.addIssue({ code: 'custom', message: 'Commission value is required.' });
    }
    if (value.commissionType === 'percentage' && (value.commissionValue ?? 0) > 100) {
      ctx.addIssue({ code: 'custom', message: 'Percentage commission cannot exceed 100%.' });
    }
    if (value.commissionType === 'fixed' && !value.commissionCurrency) {
      ctx.addIssue({ code: 'custom', message: 'Commission currency is required.' });
    }
    if (value.validFrom && value.validUntil && new Date(value.validUntil) <= new Date(value.validFrom)) {
      ctx.addIssue({ code: 'custom', message: 'Promo end date must be after its start date.' });
    }
  });

const revenueWindowSchema = z
  .object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

const commissionListSchema = z
  .object({
    status: z.enum(['pending', 'approved', 'paid', 'reversed']).nullable().optional(),
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .strict();

const settlementSchema = z
  .object({
    commissionIds: z.array(z.string().uuid()).min(1).max(200),
    paymentMethod: z.string().trim().min(2).max(80),
    transactionReference: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();

const refundSchema = z
  .object({
    orderId: z.string().uuid(),
    reason: z.string().trim().min(1).max(500),
    revokeAccess: z.boolean().default(true),
  })
  .strict();

const knownErrors: Array<[string, string]> = [
  ['ACTIVE_AUTHENTICATION_REQUIRED', 'Please sign in again.'],
  ['ADMIN_ACCESS_REQUIRED', 'Admin access is required.'],
  ['INVALID_PROMO_CODE', 'Promo code format is invalid.'],
  ['INVALID_PROMO_RULE', 'Check the promo status and rule types.'],
  ['INVALID_PROMO_WINDOW', 'Promo end date must be after its start date.'],
  ['INVALID_PROMO_LIMIT', 'Promo activation limit must be greater than zero.'],
  ['PROMO_OWNER_NOT_FOUND', 'The promo owner account was not found.'],
  ['INVALID_PROMO_DISCOUNT', 'Check the customer discount settings.'],
  ['INVALID_PROMO_COMMISSION', 'Check the commission settings.'],
  ['PROMO_NOT_FOUND', 'Promo code not found.'],
  ['INVALID_REPORT_WINDOW', 'Choose a valid report date range.'],
  ['INVALID_COMMISSION_STATUS', 'Invalid commission status.'],
  ['INVALID_SETTLEMENT_INPUT', 'Check the settlement payment details.'],
  ['COMMISSIONS_NOT_SETTLEABLE', 'Selected commissions must be approved, in one currency, and belong to one coupon owner.'],
  ['COMMISSION_ALREADY_SETTLED', 'One or more selected commissions were already settled.'],
  ['REFUND_REASON_REQUIRED', 'Add a reason for the refund.'],
  ['ORDER_NOT_FOUND', 'Order not found.'],
  ['ORDER_NOT_REFUNDABLE', 'This order is not eligible for the full-refund flow.'],
  ['CONFIRMED_PAYMENT_REQUIRED', 'No confirmed payment exists to refund.'],
  ['SETTLED_COMMISSION_REFUND_REQUIRES_RECONCILIATION', 'This sale has a commission that was already paid. Reconcile the partner payout before refunding it.'],
];

function safeError(error: { message?: string } | null, fallback: string): string {
  const message = error?.message || '';
  const match = knownErrors.find(([code]) => message.includes(code));
  if (match) return match[1];
  if (message.includes('promo_codes_code_ci_uidx')) return 'That promo code already exists.';
  return fallback;
}

function invalidInput<T>(message: string): BusinessActionResult<T> {
  return { ok: false, error: message };
}

export async function getMyCouponSummary(): Promise<BusinessActionResult<PartnerCouponSummary[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('partner_get_coupon_summary');
  if (error) {
    return { ok: false, error: safeError(error, 'Unable to load your coupon.') };
  }
  return { ok: true, data: (data || []) as PartnerCouponSummary[] };
}

export async function listAdminPromoCodes(): Promise<BusinessActionResult<AdminPromoCodeRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_list_promo_codes');
  if (error) {
    return { ok: false, error: safeError(error, 'Unable to load promo codes.') };
  }
  return { ok: true, data: (data || []) as AdminPromoCodeRow[] };
}

export async function saveAdminPromoCode(
  input: unknown,
): Promise<BusinessActionResult<{ id: number; code: string; status: string }>> {
  const parsed = promoSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput(parsed.error.issues[0]?.message || 'Check the promo code settings.');
  }

  const supabase = await createClient();
  const value = parsed.data;
  let ownerUserId: string | null = null;

  if (value.ownerEmail) {
    const { data: owner, error: ownerError } = await supabase
      .from('profiles')
      .select('id')
      .ilike('email', value.ownerEmail)
      .limit(1)
      .maybeSingle();

    if (ownerError) {
      return { ok: false, error: 'Unable to resolve the coupon owner account.' };
    }
    if (!owner) {
      return { ok: false, error: 'No Royal account exists with that coupon-owner email.' };
    }
    ownerUserId = owner.id as string;
  }

  const { data, error } = await supabase.rpc('admin_save_promo_code', {
    p_promo_id: value.promoId ?? null,
    p_code: value.code,
    p_owner_user_id: ownerUserId,
    p_status: value.status,
    p_discount_type: value.discountType,
    p_discount_value: value.discountType === 'none' ? null : value.discountValue,
    p_discount_currency:
      value.discountType === 'fixed' || value.discountType === 'special_price'
        ? value.discountCurrency
        : null,
    p_commission_type: value.commissionType,
    p_commission_value: value.commissionType === 'none' ? null : value.commissionValue,
    p_commission_currency: value.commissionType === 'fixed' ? value.commissionCurrency : null,
    p_commission_basis: value.commissionBasis,
    p_valid_from: value.validFrom,
    p_valid_until: value.validUntil,
    p_max_activations: value.maxActivations,
  });

  if (error || !data) {
    return { ok: false, error: safeError(error, 'Unable to save the promo code.') };
  }

  revalidatePath('/admin/promos');
  return { ok: true, data: data as { id: number; code: string; status: string } };
}

export async function getAdminRevenueSummary(
  input: unknown = {},
): Promise<BusinessActionResult<AdminRevenueSummary>> {
  const parsed = revenueWindowSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput('Choose a valid report date range.');
  }

  const to = parsed.data.to ? new Date(parsed.data.to) : new Date();
  const from = parsed.data.from
    ? new Date(parsed.data.from)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) {
    return invalidInput('Choose a valid report date range.');
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_get_revenue_summary', {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });

  if (error || !data) {
    return { ok: false, error: safeError(error, 'Unable to load revenue analytics.') };
  }

  return { ok: true, data: data as AdminRevenueSummary };
}

export async function listAdminCommissions(
  input: unknown = {},
): Promise<BusinessActionResult<AdminCommissionRow[]>> {
  const parsed = commissionListSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput('Invalid commission filter.');
  }

  const supabase = await createClient();
  const { status = null, limit = 100, offset = 0 } = parsed.data;
  const { data, error } = await supabase.rpc('admin_list_commissions', {
    p_status: status,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    return { ok: false, error: safeError(error, 'Unable to load commissions.') };
  }

  return { ok: true, data: (data || []) as AdminCommissionRow[] };
}

export async function createAdminCommissionSettlement(
  input: unknown,
): Promise<BusinessActionResult<AdminSettlementReceipt>> {
  const parsed = settlementSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput('Check the selected commissions and payout details.');
  }

  const uniqueIds = [...new Set(parsed.data.commissionIds)];
  if (uniqueIds.length !== parsed.data.commissionIds.length) {
    return invalidInput('Remove duplicate commissions from the payout.');
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_create_commission_settlement', {
    p_commission_ids: uniqueIds,
    p_payment_method: parsed.data.paymentMethod,
    p_transaction_reference: parsed.data.transactionReference || null,
    p_notes: parsed.data.notes || null,
  });

  if (error || !data) {
    return { ok: false, error: safeError(error, 'Unable to record the commission payout.') };
  }

  revalidatePath('/admin/commissions');
  revalidatePath('/admin/revenue');
  return { ok: true, data: data as AdminSettlementReceipt };
}

export async function refundAdminUpgradeOrder(
  input: unknown,
): Promise<BusinessActionResult<AdminRefundReceipt>> {
  const parsed = refundSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput('Choose a valid order and add a refund reason.');
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_refund_upgrade_order', {
    p_order_id: parsed.data.orderId,
    p_reason: parsed.data.reason,
    p_revoke_access: parsed.data.revokeAccess,
  });

  if (error || !data) {
    return { ok: false, error: safeError(error, 'Unable to refund the order.') };
  }

  revalidatePath('/admin/revenue');
  revalidatePath('/admin/commissions');
  revalidatePath('/admin/promos');
  revalidatePath('/support');
  return { ok: true, data: data as AdminRefundReceipt };
}

'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type {
  BusinessActionResult,
  SupportUpgradeDetail,
  SupportUpgradeQueueItem,
  UpgradeRequestReceipt,
  UpgradeRequestStatus,
} from '@/types/business';

const upgradeRequestSchema = z
  .object({
    scopeType: z.enum(['global', 'pathway', 'bank']),
    pathwayId: z.number().int().positive().nullable().optional(),
    bankId: z.number().int().positive().nullable().optional(),
    promoCode: z.string().trim().max(32).optional(),
  })
  .strict();

const supportListSchema = z
  .object({
    status: z.enum(['pending', 'contacted', 'paid', 'activated', 'cancelled']).nullable().optional(),
    search: z.string().trim().max(200).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .strict();

const requestIdSchema = z.string().uuid();

const saveOrderSchema = z
  .object({
    requestId: requestIdSchema,
    durationMonths: z.number().int().min(1).max(120).nullable(),
    basePrice: z.number().min(0),
    discountAmount: z.number().min(0),
    agreedPrice: z.number().positive(),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
    internalNotes: z.string().trim().max(1000).optional(),
  })
  .strict();

const recordPaymentSchema = z
  .object({
    requestId: requestIdSchema,
    amount: z.number().positive(),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
    paymentMethod: z.string().trim().min(2).max(80),
    transactionReference: z.string().trim().min(1).max(200),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();

const cancelRequestSchema = z
  .object({
    requestId: requestIdSchema,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

const knownErrors: Array<[string, string]> = [
  ['ACTIVE_AUTHENTICATION_REQUIRED', 'Please sign in again before creating an upgrade request.'],
  ['INVALID_UPGRADE_SCOPE', 'Choose a valid Royal access option.'],
  ['ACCESS_ALREADY_ACTIVE', 'This access is already active on the account.'],
  ['ACTIVE_SUBSCRIPTION_EXISTS', 'This customer already has a live Royal subscription. Resolve that subscription before activating another product.'],
  ['OPEN_UPGRADE_REQUEST_EXISTS', 'This customer already has an open subscription request. Resolve it first.'],
  ['PROMO_CODE_INVALID', 'That promo code is invalid or expired.'],
  ['PROMO_CODE_LIMIT_REACHED', 'That promo code has reached its activation limit.'],
  ['SUPPORT_ACCESS_REQUIRED', 'Support or admin access is required.'],
  ['UPGRADE_REQUEST_NOT_FOUND', 'Upgrade request not found.'],
  ['UPGRADE_REQUEST_CANCELLED', 'This upgrade request has been cancelled.'],
  ['INVALID_REQUEST_STATUS', 'Invalid request status filter.'],
  ['INVALID_ACCESS_DURATION', 'Choose a valid access duration.'],
  ['INVALID_ORDER_VALUES', 'Check the order price, discount, duration, and currency.'],
  ['ORDER_LOCKED', 'This order can no longer be edited.'],
  ['ORDER_REQUIRED', 'Create the order before recording payment or activating access.'],
  ['INVALID_PAYMENT_VALUES', 'Check the payment amount, method, currency, and transaction reference.'],
  ['PAYMENT_REFERENCE_ALREADY_USED', 'This transaction reference has already been recorded for another payment or with different details.'],
  ['PAYMENT_CURRENCY_MISMATCH', 'Payment currency must match the order currency.'],
  ['PAYMENT_LOCKED', 'This request no longer accepts payments.'],
  ['PAYMENT_REQUIRED', 'Confirmed payment must cover the agreed price before activation.'],
  ['USER_INACTIVE', 'The customer account is inactive.'],
  ['COMMISSION_CURRENCY_MISMATCH', 'The promo commission currency does not match this order.'],
  ['CANCEL_REASON_REQUIRED', 'Add a reason before cancelling the request.'],
  ['ACTIVATED_REQUEST_CANNOT_BE_CANCELLED', 'Activated requests cannot be cancelled here.'],
  ['PAID_REQUEST_CANNOT_BE_CANCELLED', 'A paid request must be handled through the payment/refund flow.'],
];

function safeError(error: { message?: string } | null, fallback: string): string {
  const message = error?.message || '';
  const match = knownErrors.find(([code]) => message.includes(code));
  return match?.[1] || fallback;
}

function invalidInput<T>(message: string): BusinessActionResult<T> {
  return { ok: false, error: message };
}

export async function createUpgradeRequest(
  input: unknown,
): Promise<BusinessActionResult<UpgradeRequestReceipt>> {
  const parsed = upgradeRequestSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput('Choose a valid access option and promo code.');
  }

  const { scopeType, pathwayId = null, bankId = null, promoCode } = parsed.data;
  if (
    (scopeType === 'global' && (pathwayId !== null || bankId !== null)) ||
    (scopeType === 'pathway' && (pathwayId === null || bankId !== null)) ||
    (scopeType === 'bank' && (bankId === null || pathwayId !== null))
  ) {
    return invalidInput('Choose a valid access option.');
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_upgrade_request', {
    p_scope_type: scopeType,
    p_pathway_id: pathwayId,
    p_bank_id: bankId,
    p_promo_code: promoCode?.trim() || null,
  });

  if (error || !data) {
    return {
      ok: false,
      error: safeError(error, 'Unable to create the upgrade request. Please try again.'),
    };
  }

  return { ok: true, data: data as UpgradeRequestReceipt };
}

export async function listSupportUpgradeRequests(
  input: unknown = {},
): Promise<BusinessActionResult<SupportUpgradeQueueItem[]>> {
  const parsed = supportListSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput('Invalid support queue filter.');
  }

  const supabase = await createClient();
  const { status = null, search = '', limit = 50, offset = 0 } = parsed.data;
  const { data, error } = await supabase.rpc('support_list_upgrade_requests', {
    p_status: status,
    p_search: search || null,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    return {
      ok: false,
      error: safeError(error, 'Unable to load upgrade requests.'),
    };
  }

  return { ok: true, data: (data || []) as SupportUpgradeQueueItem[] };
}

export async function getSupportUpgradeRequest(
  requestId: string,
): Promise<BusinessActionResult<SupportUpgradeDetail>> {
  const parsed = requestIdSchema.safeParse(requestId);
  if (!parsed.success) {
    return invalidInput('Invalid upgrade request.');
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('support_get_upgrade_request', {
    p_request_id: parsed.data,
  });

  if (error || !data) {
    return {
      ok: false,
      error: safeError(error, 'Unable to load the upgrade request.'),
    };
  }

  return { ok: true, data: data as SupportUpgradeDetail };
}

async function requestMutation<T>(
  rpcName:
    | 'support_mark_upgrade_contacted'
    | 'support_activate_upgrade',
  requestId: string,
  fallback: string,
): Promise<BusinessActionResult<T>> {
  const parsed = requestIdSchema.safeParse(requestId);
  if (!parsed.success) {
    return invalidInput('Invalid upgrade request.');
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(rpcName, {
    p_request_id: parsed.data,
  });

  if (error || !data) {
    return { ok: false, error: safeError(error, fallback) };
  }

  revalidatePath('/support');
  return { ok: true, data: data as T };
}

export async function markSupportUpgradeContacted(
  requestId: string,
): Promise<BusinessActionResult<{ request_id: string; status: UpgradeRequestStatus }>> {
  return requestMutation('support_mark_upgrade_contacted', requestId, 'Unable to update the request.');
}

export async function saveSupportUpgradeOrder(
  input: unknown,
): Promise<BusinessActionResult<{ order_id: string; status: string; agreed_price: number | string; currency: string }>> {
  const parsed = saveOrderSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput('Check the order price, duration, currency, and notes.');
  }

  const supabase = await createClient();
  const value = parsed.data;
  const { data, error } = await supabase.rpc('support_save_upgrade_order', {
    p_request_id: value.requestId,
    p_duration_months: value.durationMonths,
    p_base_price: value.basePrice,
    p_discount_amount: value.discountAmount,
    p_agreed_price: value.agreedPrice,
    p_currency: value.currency,
    p_internal_notes: value.internalNotes || null,
  });

  if (error || !data) {
    return { ok: false, error: safeError(error, 'Unable to save the order.') };
  }

  revalidatePath('/support');
  return { ok: true, data: data as { order_id: string; status: string; agreed_price: number | string; currency: string } };
}

export async function recordSupportUpgradePayment(
  input: unknown,
): Promise<BusinessActionResult<{
  payment_id: string;
  paid_amount: number | string;
  agreed_price: number | string;
  amount_due: number | string;
  paid_enough: boolean;
  idempotent?: boolean;
}>> {
  const parsed = recordPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput('Enter the payment amount, method, currency, and transaction reference.');
  }

  const supabase = await createClient();
  const value = parsed.data;
  const { data, error } = await supabase.rpc('support_record_upgrade_payment', {
    p_request_id: value.requestId,
    p_amount: value.amount,
    p_currency: value.currency,
    p_payment_method: value.paymentMethod,
    p_transaction_reference: value.transactionReference,
    p_notes: value.notes || null,
  });

  if (error || !data) {
    return { ok: false, error: safeError(error, 'Unable to record the payment.') };
  }

  revalidatePath('/support');
  return {
    ok: true,
    data: data as {
      payment_id: string;
      paid_amount: number | string;
      agreed_price: number | string;
      amount_due: number | string;
      paid_enough: boolean;
      idempotent?: boolean;
    },
  };
}

export async function activateSupportUpgrade(
  requestId: string,
): Promise<BusinessActionResult<{
  request_id: string;
  public_code: string;
  status: UpgradeRequestStatus;
  access_grant_id: number;
  already_activated: boolean;
}>> {
  return requestMutation('support_activate_upgrade', requestId, 'Unable to activate access.');
}

export async function cancelSupportUpgrade(
  input: unknown,
): Promise<BusinessActionResult<{ request_id: string; status: UpgradeRequestStatus }>> {
  const parsed = cancelRequestSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput('Add a valid cancellation reason.');
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('support_cancel_upgrade', {
    p_request_id: parsed.data.requestId,
    p_reason: parsed.data.reason,
  });

  if (error || !data) {
    return { ok: false, error: safeError(error, 'Unable to cancel the request.') };
  }

  revalidatePath('/support');
  return { ok: true, data: data as { request_id: string; status: UpgradeRequestStatus } };
}

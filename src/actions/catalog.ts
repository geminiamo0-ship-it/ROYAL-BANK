'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { BusinessActionResult } from '@/types/business';
import type {
  AdminCatalogPayload,
  CatalogQuotePreview,
  CatalogUpgradeOffer,
  CatalogUpgradeReceipt,
} from '@/types/catalog';

const scopeSchema = z.object({
  scopeType: z.enum(['pathway', 'bank']),
  targetId: z.number().int().positive(),
}).strict();

const quoteSchema = z.object({
  planId: z.number().int().positive(),
  promoCode: z.string().trim().max(32).optional(),
}).strict();

const requestSchema = z.object({
  planId: z.number().int().positive(),
  promoCode: z.string().trim().max(32).optional(),
  replaceRequestId: z.string().uuid().nullable().optional(),
}).strict();

const productSchema = z.object({
  productId: z.number().int().positive(),
  status: z.enum(['draft', 'active', 'hidden', 'archived']),
  displayOrder: z.number().int().min(0),
  showPrices: z.boolean(),
  scopeDescription: z.string().trim().max(300).optional(),
}).strict();

const planSchema = z.object({
  planId: z.number().int().positive().nullable().optional(),
  productId: z.number().int().positive(),
  name: z.string().trim().min(1).max(120),
  durationMonths: z.number().int().min(1).max(120),
  price: z.number().min(0),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  status: z.enum(['active', 'inactive', 'archived']),
  showPrice: z.boolean(),
  isDefault: z.boolean(),
  isRecommended: z.boolean(),
  displayOrder: z.number().int().min(0),
}).strict();

const trialSchema = z.object({
  bankId: z.number().int().positive(),
  isFreeTrial: z.boolean(),
  blockLimit: z.number().int().min(0).max(1000),
  questionLimit: z.number().int().min(0).max(100000),
  articleLimit: z.number().int().min(0).max(100000),
}).strict();

const requestIdSchema = z.string().uuid();

const errors: Array<[string, string]> = [
  ['ADMIN_ACCESS_REQUIRED', 'Admin access is required.'],
  ['ACTIVE_AUTHENTICATION_REQUIRED', 'Please sign in again.'],
  ['CATALOG_PRODUCT_UNAVAILABLE', 'This product is not currently available for upgrade.'],
  ['CATALOG_PLAN_UNAVAILABLE', 'This duration is not currently available.'],
  ['CATALOG_PRODUCT_NOT_FOUND', 'Catalog product not found.'],
  ['CATALOG_PLAN_NOT_FOUND', 'Catalog plan not found.'],
  ['ACTIVE_PRODUCT_REQUIRES_ACTIVE_PLAN', 'Add at least one active priced plan before activating this product.'],
  ['INVALID_CATALOG_PRODUCT', 'Check the product status, order, and visibility settings.'],
  ['INVALID_CATALOG_PLAN', 'Check the plan name, duration, price, currency, and status.'],
  ['INVALID_TRIAL_CONFIGURATION', 'Check the free-trial limits.'],
  ['ARCHIVED_PRODUCT_IS_IMMUTABLE', 'Archived products are read-only.'],
  ['ARCHIVED_PLAN_IS_IMMUTABLE', 'Archived plans are read-only.'],
  ['PROMO_CODE_INVALID', 'That promo code is invalid or expired.'],
  ['PROMO_CODE_LIMIT_REACHED', 'That promo code has reached its activation limit.'],
  ['PROMO_CURRENCY_MISMATCH', 'This promo code cannot be used with the selected currency.'],
  ['PROMO_SPECIAL_PRICE_INVALID', 'This promo code cannot be applied to the selected plan.'],
  ['ACCESS_ALREADY_COVERED_BY_BROADER_GRANT', 'Your current access already includes this product.'],
  ['ACCESS_ALREADY_LIFETIME', 'You already have lifetime access to this product.'],
  ['UPGRADE_REQUEST_ALREADY_PENDING', 'You already have an open request for this product. Use Change Request to switch duration.'],
  ['UPGRADE_REQUEST_NOT_REPLACEABLE', 'This request can no longer be changed.'],
  ['UPGRADE_REQUEST_NOT_CANCELLABLE', 'This request can no longer be cancelled.'],
  ['PAID_REQUEST_CANNOT_BE_REPLACED', 'A paid request cannot be changed.'],
  ['PAID_REQUEST_CANNOT_BE_CANCELLED', 'A paid request cannot be cancelled.'],
];

function safeError(error: { message?: string } | null, fallback: string): string {
  const message = error?.message || '';
  const known = errors.find(([code]) => message.includes(code));
  return known?.[1] || fallback;
}

function invalid<T>(message: string): BusinessActionResult<T> {
  return { ok: false, error: message };
}

export async function getCatalogUpgradeOffer(input: unknown): Promise<BusinessActionResult<CatalogUpgradeOffer>> {
  const parsed = scopeSchema.safeParse(input);
  if (!parsed.success) return invalid('Choose a valid Royal product.');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_catalog_upgrade_offer', {
    p_scope_type: parsed.data.scopeType,
    p_target_id: parsed.data.targetId,
  });
  if (error || !data) return { ok: false, error: safeError(error, 'Unable to load upgrade options.') };
  return { ok: true, data: data as CatalogUpgradeOffer };
}

export async function previewCatalogQuote(input: unknown): Promise<BusinessActionResult<CatalogQuotePreview>> {
  const parsed = quoteSchema.safeParse(input);
  if (!parsed.success) return invalid('Choose a valid plan and promo code.');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('preview_catalog_quote', {
    p_plan_id: parsed.data.planId,
    p_promo_code: parsed.data.promoCode || null,
  });
  if (error || !data) return { ok: false, error: safeError(error, 'Unable to preview this price.') };
  return { ok: true, data: data as CatalogQuotePreview };
}

export async function createCatalogUpgradeRequest(input: unknown): Promise<BusinessActionResult<CatalogUpgradeReceipt>> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return invalid('Choose a valid plan and promo code.');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_catalog_upgrade_request', {
    p_plan_id: parsed.data.planId,
    p_promo_code: parsed.data.promoCode || null,
    p_replace_request_id: parsed.data.replaceRequestId || null,
  });
  if (error || !data) return { ok: false, error: safeError(error, 'Unable to create the upgrade request.') };
  revalidatePath('/dashboard');
  return { ok: true, data: data as CatalogUpgradeReceipt };
}

export async function cancelCatalogUpgradeRequest(requestId: string): Promise<BusinessActionResult<{ request_id: string; status: 'cancelled' }>> {
  const parsed = requestIdSchema.safeParse(requestId);
  if (!parsed.success) return invalid('Invalid upgrade request.');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('cancel_my_catalog_upgrade_request', { p_request_id: parsed.data });
  if (error || !data) return { ok: false, error: safeError(error, 'Unable to cancel this request.') };
  revalidatePath('/dashboard');
  return { ok: true, data: data as { request_id: string; status: 'cancelled' } };
}

export async function getAdminCatalog(): Promise<BusinessActionResult<AdminCatalogPayload>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_list_catalog');
  if (error || !data) return { ok: false, error: safeError(error, 'Unable to load catalog management.') };
  return { ok: true, data: data as AdminCatalogPayload };
}

export async function saveAdminCatalogProduct(input: unknown): Promise<BusinessActionResult<{ id: number; status: string }>> {
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return invalid('Check the product settings.');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_save_catalog_product', {
    p_product_id: parsed.data.productId,
    p_status: parsed.data.status,
    p_display_order: parsed.data.displayOrder,
    p_show_prices: parsed.data.showPrices,
    p_scope_description: parsed.data.scopeDescription || null,
  });
  if (error || !data) return { ok: false, error: safeError(error, 'Unable to save the product.') };
  revalidatePath('/admin/catalog');
  revalidatePath('/dashboard');
  return { ok: true, data: data as { id: number; status: string } };
}

export async function saveAdminCatalogPlan(input: unknown): Promise<BusinessActionResult<{ id: number; product_id: number; status: string; version: number }>> {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return invalid('Check the plan duration, price, currency, and status.');
  const value = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_save_catalog_plan', {
    p_plan_id: value.planId || null,
    p_product_id: value.productId,
    p_name: value.name,
    p_duration_months: value.durationMonths,
    p_price: value.price,
    p_currency: value.currency,
    p_status: value.status,
    p_show_price: value.showPrice,
    p_is_default: value.isDefault,
    p_is_recommended: value.isRecommended,
    p_display_order: value.displayOrder,
  });
  if (error || !data) return { ok: false, error: safeError(error, 'Unable to save the plan.') };
  revalidatePath('/admin/catalog');
  revalidatePath('/dashboard');
  return { ok: true, data: data as { id: number; product_id: number; status: string; version: number } };
}

export async function updateAdminCatalogBankTrial(input: unknown): Promise<BusinessActionResult<{ bank_id: number }>> {
  const parsed = trialSchema.safeParse(input);
  if (!parsed.success) return invalid('Check the free-trial settings.');
  const value = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_update_catalog_bank_trial', {
    p_bank_id: value.bankId,
    p_is_free_trial: value.isFreeTrial,
    p_block_limit: value.blockLimit,
    p_question_limit: value.questionLimit,
    p_article_limit: value.articleLimit,
  });
  if (error || !data) return { ok: false, error: safeError(error, 'Unable to save the free-trial settings.') };
  revalidatePath('/admin/catalog');
  revalidatePath('/dashboard');
  return { ok: true, data: data as { bank_id: number } };
}

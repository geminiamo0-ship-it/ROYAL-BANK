export type CatalogProductType = 'global' | 'pathway' | 'bank';
export type CatalogProductStatus = 'draft' | 'active' | 'hidden' | 'archived';
export type CatalogPlanStatus = 'active' | 'inactive' | 'archived';
export type AccessCoverageKind = 'none' | 'exact' | 'broader';

export interface AccessResolution {
  has_access: boolean;
  coverage_kind: AccessCoverageKind;
  can_extend: boolean;
  expires_soon: boolean;
  grant_id: number | null;
  scope_type: CatalogProductType | null;
  pathway_id: number | null;
  question_bank_id: number | null;
  starts_at: string | null;
  expires_at: string | null;
  is_lifetime: boolean;
}

export interface CatalogUpgradePlan {
  id: number;
  name: string;
  duration_months: number | null;
  currency: string;
  price_visible: boolean;
  price: number | string | null;
  is_default: boolean;
  is_recommended: boolean;
  display_order: number;
  version: number;
}

export interface CatalogPendingRequest {
  request_id: string;
  public_code: string;
  status: 'pending' | 'contacted' | 'paid';
  catalog_product_id: number | null;
  catalog_plan_id: number | null;
  plan_name: string | null;
  duration_months: number | null;
  currency: string | null;
  price_visible: boolean;
  base_price: number | string | null;
  discount_amount: number | string | null;
  final_price: number | string | null;
  promo_code: string | null;
  legacy: boolean;
  can_cancel: boolean;
  can_change: boolean;
}

export interface CatalogUpgradeOffer {
  product: {
    id: number;
    product_type: CatalogProductType;
    target_id: number | null;
    name: string;
    scope_description: string;
    show_prices: boolean;
  };
  plans: CatalogUpgradePlan[];
  access: AccessResolution;
  pending_request: CatalogPendingRequest | null;
  mode: 'upgrade' | 'extension' | 'active' | 'pending';
  can_request: boolean;
}

export interface CatalogQuotePreview {
  plan_id: number;
  plan_name: string;
  duration_months: number | null;
  currency: string;
  price_visible: boolean;
  base_price: number | string | null;
  discount_amount: number | string | null;
  final_price: number | string | null;
  promo_applied: boolean;
  promo_code: string | null;
}

export interface CatalogUpgradeReceipt {
  request_id: string;
  public_code: string;
  status: 'pending' | 'contacted' | 'paid';
  scope_type: CatalogProductType;
  product_name: string;
  plan_name: string | null;
  duration_months: number | null;
  currency: string | null;
  price_visible: boolean;
  base_price: number | string | null;
  discount_amount: number | string | null;
  final_price: number | string | null;
  promo_applied: boolean;
  existing: boolean;
}

export interface AdminCatalogPlan {
  id: number;
  product_id: number;
  name: string;
  duration_months: number | null;
  price: number | string | null;
  currency: string;
  status: CatalogPlanStatus;
  show_price: boolean;
  is_default: boolean;
  is_recommended: boolean;
  display_order: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface AdminCatalogProduct {
  id: number;
  product_type: CatalogProductType;
  pathway_id: number | null;
  question_bank_id: number | null;
  name: string;
  status: CatalogProductStatus;
  display_order: number;
  show_prices: boolean;
  scope_description: string;
  created_at: string;
  updated_at: string;
  trial: {
    is_free_trial: boolean;
    free_trial_block_limit: number;
    free_trial_question_limit: number;
    free_trial_article_limit: number;
  } | null;
  plans: AdminCatalogPlan[];
}

export interface CatalogAuditEntry {
  id: number;
  actor_user_id: string | null;
  entity_type: 'product' | 'plan' | 'bank_trial';
  entity_id: number;
  action: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  created_at: string;
}

export interface AdminCatalogPayload {
  products: AdminCatalogProduct[];
  audit: CatalogAuditEntry[];
}

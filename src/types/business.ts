export type UpgradeScopeType = 'global' | 'pathway' | 'bank';
export type UpgradeRequestStatus = 'pending' | 'contacted' | 'paid' | 'activated' | 'cancelled';

export interface UpgradeCatalogPathway {
  id: number;
  name: string;
  slug: string;
}

export interface UpgradeCatalogBank {
  id: number;
  pathway_id: number;
  name: string;
}

export interface UpgradeRequestReceipt {
  request_id: string;
  public_code: string;
  status: UpgradeRequestStatus;
  scope_type: UpgradeScopeType;
  product_name: string;
  promo_applied: boolean;
}

export interface SupportUpgradeQueueItem {
  request_id: string;
  public_code: string;
  request_status: UpgradeRequestStatus;
  created_at: string;
  full_name: string | null;
  email: string;
  scope_type: UpgradeScopeType;
  product_name: string;
  promo_code: string | null;
  order_id: string | null;
  order_status: string | null;
  agreed_price: number | string | null;
  currency: string | null;
  paid_amount: number | string;
}

export interface SupportUpgradeDetail {
  request: {
    id: string;
    public_code: string;
    status: UpgradeRequestStatus;
    scope_type: UpgradeScopeType;
    pathway_id: number | null;
    question_bank_id: number | null;
    product_name: string;
    promo_code: string | null;
    created_at: string;
    contacted_at: string | null;
    activated_at: string | null;
    access_grant_id: number | null;
  };
  user: {
    id: string;
    full_name: string | null;
    email: string;
    is_active: boolean;
    subscription_tier: string;
  };
  promo: {
    code: string;
    discount_type: 'none' | 'percentage' | 'fixed' | 'special_price';
    discount_value: number | string | null;
    discount_currency: string | null;
  } | null;
  order: {
    id: string;
    duration_months: number | null;
    base_price: number | string;
    discount_amount: number | string;
    agreed_price: number | string;
    currency: string;
    internal_notes: string | null;
    status: string;
    paid_amount: number | string;
    amount_due: number | string;
  } | null;
  payments: Array<{
    id: string;
    amount: number | string;
    currency: string;
    payment_method: string;
    transaction_reference: string | null;
    notes: string | null;
    status: string;
    paid_at: string;
  }>;
  active_access: Array<{
    id: number;
    scope_type: UpgradeScopeType;
    pathway_id: number | null;
    question_bank_id: number | null;
    starts_at: string;
    expires_at: string | null;
  }>;
}

export type BusinessActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

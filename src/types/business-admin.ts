export interface PartnerCouponSummary {
  code: string;
  activated_users: number | string;
}

export interface AdminPromoCodeRow {
  id: number;
  code: string;
  owner_user_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  status: 'active' | 'inactive';
  discount_type: 'none' | 'percentage' | 'fixed' | 'special_price';
  discount_value: number | string | null;
  discount_currency: string | null;
  commission_type: 'none' | 'percentage' | 'fixed';
  commission_value: number | string | null;
  commission_currency: string | null;
  commission_basis: 'amount_paid' | 'agreed_price';
  valid_from: string | null;
  valid_until: string | null;
  max_activations: number | null;
  activated_users: number | string;
  successful_activations: number | string;
  created_at: string;
}

export interface AdminRevenueCurrencySummary {
  currency: string;
  orders_count: number | string;
  gross_sales: number | string;
  discounts: number | string;
  booked_sales: number | string;
  gross_collected: number | string;
  refunds: number | string;
  net_collected: number | string;
  commissions: number | string;
  contribution_profit: number | string;
  activations: number | string;
  unique_customers: number | string;
}

export interface AdminRevenueSummary {
  from: string;
  to: string;
  currencies: AdminRevenueCurrencySummary[];
}

export interface AdminCommissionRow {
  commission_id: string;
  order_id: string;
  promo_code: string;
  partner_user_id: string;
  partner_name: string | null;
  partner_email: string;
  commission_amount: number | string;
  currency: string;
  status: 'pending' | 'approved' | 'paid' | 'reversed';
  created_at: string;
  approved_at: string | null;
  paid_at: string | null;
  settlement_id: string | null;
  settlement_paid_at: string | null;
}

export interface AdminSettlementReceipt {
  settlement_id: string;
  partner_user_id: string;
  amount: number | string;
  currency: string;
  commission_count: number;
  paid_at: string;
}

export interface AdminRefundReceipt {
  order_id: string;
  status: 'refunded';
  refunded_amount?: number | string;
  currency?: string;
  access_revoked?: boolean;
  already_refunded: boolean;
}

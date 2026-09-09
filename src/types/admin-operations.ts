export interface AdminUserListRow {
  id: string;
  full_name: string | null;
  email: string;
  role: 'student' | 'support' | 'admin' | string;
  subscription_tier: string;
  is_active: boolean;
  last_login_at: string | null;
  last_login_ip: string | null;
  created_at: string;
  active_grant_count: number | string;
  latest_access_expires_at: string | null;
}

export interface AdminAccessGrantDetail {
  id: number;
  scope_type: 'global' | 'pathway' | 'bank';
  pathway_id: number | null;
  question_bank_id: number | null;
  scope_name: string;
  starts_at: string;
  expires_at: string | null;
  created_at: string;
  granted_by: string | null;
  granted_by_name: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  revoked_by_name: string | null;
  revoke_reason: string | null;
  status: 'active' | 'upcoming' | 'expired' | 'revoked';
}

export interface AdminUserAuditRow {
  id: number;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AdminUserDetail {
  profile: {
    id: string;
    full_name: string | null;
    email: string;
    role: 'student' | 'support' | 'admin' | string;
    subscription_tier: string;
    is_active: boolean;
    last_login_at: string | null;
    last_login_ip: string | null;
    created_at: string;
    updated_at: string;
  };
  grants: AdminAccessGrantDetail[];
  audit: AdminUserAuditRow[];
}

export interface AdminOperationsSummary {
  total_users: number | string;
  active_users: number | string;
  inactive_users: number | string;
  student_users: number | string;
  support_users: number | string;
  admin_users: number | string;
  active_grants: number | string;
  open_requests: number | string;
  pending_requests: number | string;
  contacted_requests: number | string;
  paid_awaiting_activation: number | string;
  activations_30d: number | string;
  new_users_30d: number | string;
}

export interface AdminSupportAgentPerformance {
  user_id: string;
  full_name: string | null;
  email: string;
  role: string;
  contacts: number | string;
  activations: number | string;
  payments_recorded: number | string;
  avg_first_contact_minutes: number | string | null;
  avg_activation_minutes: number | string | null;
}

export interface AdminSupportPerformance {
  from: string;
  to: string;
  summary: {
    contacts: number | string;
    activations: number | string;
    payments_recorded: number | string;
    avg_first_contact_minutes: number | string | null;
    avg_activation_minutes: number | string | null;
    open_backlog: number | string;
    paid_awaiting_activation: number | string;
  };
  agents: AdminSupportAgentPerformance[];
}

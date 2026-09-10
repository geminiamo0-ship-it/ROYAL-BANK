export interface IntelligenceWindow {
  from: string;
  to: string;
}

export interface TrialAnalytics extends IntelligenceWindow {
  summary: {
    trial_starters: number | string;
    active_trial_users: number | string;
    trial_blocks_consumed: number | string;
    trial_sessions_started: number | string;
    trial_questions_answered: number | string;
    exhausted_trial_users: number | string;
    converted_users: number | string;
    conversion_rate_percent: number | string;
    avg_hours_to_convert: number | string | null;
  };
  by_bank: Array<{
    bank_id: number;
    bank_name: string;
    block_limit: number | null;
    question_limit: number;
    starters: number | string;
    active_users: number | string;
    blocks_consumed: number | string;
    converted_users: number | string;
    conversion_rate_percent: number | string;
  }>;
  daily: Array<{
    date: string;
    active_users: number | string;
    new_starters: number | string;
    blocks_consumed: number | string;
    conversions: number | string;
  }>;
}

export interface ProductAnalytics extends IntelligenceWindow {
  summary: {
    dau: number | string;
    wau: number | string;
    mau: number | string;
    active_users: number | string;
    returning_users: number | string;
    new_users: number | string;
    sessions_started: number | string;
    sessions_completed: number | string;
    session_completion_rate_percent: number | string;
    questions_answered: number | string;
    answer_accuracy_percent: number | string;
    avg_answer_seconds: number | string | null;
    retention_7d_cohort: number | string;
    retained_7d_users: number | string;
    retention_7d_percent: number | string;
  };
  by_bank: Array<{
    bank_id: number;
    bank_name: string;
    active_users: number | string;
    sessions_started: number | string;
    sessions_completed: number | string;
    completion_rate_percent: number | string;
    questions_answered: number | string;
    accuracy_percent: number | string;
  }>;
  session_types: Array<{
    session_type: string;
    sessions: number | string;
    completed: number | string;
    completion_rate_percent: number | string;
  }>;
  daily: Array<{
    date: string;
    active_users: number | string;
    sessions_started: number | string;
    questions_answered: number | string;
    accuracy_percent: number | string;
  }>;
}

export interface SecurityRisk extends IntelligenceWindow {
  summary: {
    manual_review_accounts: number | string;
    high_risk_accounts: number | string;
    medium_risk_accounts: number | string;
    currently_question_blocked: number | string;
    currently_session_blocked: number | string;
    gateway_escalated_accounts: number | string;
    security_events: number | string;
    suspicious_logins: number | string;
    blocked_ips: number | string;
  };
  accounts: Array<{
    user_id: string;
    full_name: string | null;
    email: string | null;
    is_active: boolean | null;
    risk_score: number;
    severity: 'critical' | 'high' | 'medium' | 'low';
    manual_review_required: boolean;
    manual_review_reason: string | null;
    question_blocked_until: string | null;
    question_block_reason: string | null;
    session_create_blocked_until: string | null;
    session_create_block_reason: string | null;
    gateway_reject_count: number;
    gateway_escalation_count: number;
    gateway_last_rejected_at: string | null;
    gateway_last_escalated_at: string | null;
    updated_at: string;
  }>;
  event_types: Array<{ event_type: string; count: number | string }>;
  recent_events: Array<{
    id: number;
    event_type: string;
    user_id: string | null;
    email: string | null;
    full_name: string | null;
    question_bank_id: number | null;
    bank_name: string | null;
    session_id: string | null;
    occurred_at: string;
    metadata: Record<string, unknown>;
  }>;
  suspicious_logins: Array<{
    id: number;
    user_id: string | null;
    email: string | null;
    full_name: string | null;
    ip_address: string | null;
    user_agent: string | null;
    login_at: string;
  }>;
  blocked_ips: Array<{
    id: number;
    ip_address: string;
    reason: string | null;
    blocked_by: string | null;
    blocked_by_name: string | null;
    blocked_at: string;
  }>;
}

export interface IntelligenceAlert {
  alert_key: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  metric_value: number | string | null;
  href: string;
  observed_at: string;
}

export interface IntelligenceReport extends IntelligenceWindow {
  generated_at: string;
  trial: TrialAnalytics;
  product: ProductAnalytics;
  security: SecurityRisk;
  support: Record<string, unknown>;
  revenue: Record<string, unknown>;
  alerts: IntelligenceAlert[];
}

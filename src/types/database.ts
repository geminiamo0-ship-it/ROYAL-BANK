export type UserRole = 'student' | 'admin' | 'support';
export type SubscriptionTier = 'free_trial' | 'premium_individual' | 'premium_full';
export type AccessScope = 'global' | 'pathway' | 'bank';
export type SessionType = 'standard' | 'tutor' | 'timed' | 'fixed_timed' | 'mock_exam' | 'review' | 'quick_champion';
export type QuestionSelection = 'new_only' | 'incorrect_only' | 'all' | 'flagged_only' | 'suspended_only';

export interface Profile {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  role: UserRole;
  subscription_tier: SubscriptionTier;
  is_active: boolean;
  last_login_at: string | null;
  last_login_ip: string | null;
  created_at: string;
  updated_at: string;
}

export interface Pathway {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  icon_url: string | null;
  is_free_trial_available: boolean;
  display_order: number;
  created_at: string;
}

export interface QuestionBank {
  id: number;
  pathway_id: number;
  name: string;
  description: string | null;
  display_order: number;
  is_free_trial: boolean;
  free_trial_block_limit: number | null;
  free_trial_question_limit: number;
  free_trial_article_limit: number;
  created_at: string;
}

export interface Block {
  id: number;
  name: string;
  question_bank_id: number;
  max_questions: number;
  is_free: boolean;
  display_order: number;
  created_at: string;
}

export interface Question {
  id: number;
  main_id: number | null;
  text_html: string;
  explanation_html: string;
  category: string;
  topic: string | null;
  concept: string | null;
  concept_id: string | null;
  notes_id: string | null;
  difficulty: string;
  source: string;
  pm_question_id: string | null;
  concepts_json: string | null;
  created_at: string;
  options?: Option[];
}

export interface Option {
  id: number;
  question_id: number;
  text_html: string;
  is_correct: boolean;
  option_order: number;
  percentage: number;
}

export interface LibraryArticle {
  id: string;
  name: string;
  category: string | null;
  content_html: string;
  source: string;
  created_at: string;
}

export interface QuestionBankLibraryArticle {
  question_bank_id: number;
  article_id: string;
  display_order: number;
  created_at: string;
}

export interface UserAccessGrant {
  id: number;
  user_id: string;
  scope_type: AccessScope;
  pathway_id: number | null;
  question_bank_id: number | null;
  starts_at: string;
  expires_at: string | null;
  granted_by: string | null;
  created_at: string;
}

export interface TestSession {
  id: string;
  user_id: string;
  question_bank_id: number | null;
  session_type: SessionType;
  categories: string[] | null;
  difficulty_filter: string[] | null;
  topic_filters: Array<{ category: string; topic: string }>;
  question_selection: QuestionSelection;
  total_questions: number;
  time_limit_minutes: number | null;
  started_at: string;
  completed_at: string | null;
  score_percentage: number | null;
  is_completed: boolean;
}

export interface UserAnswer {
  id: number;
  test_session_id: string;
  user_id: string;
  question_id: number;
  selected_option_id: number | null;
  is_correct: boolean;
  is_flagged: boolean;
  time_spent_seconds: number;
  answered_at: string;
}

export interface UserNote {
  id: number;
  user_id: string;
  question_id: number;
  note_html: string;
  highlights_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface SavedConcept {
  id: number;
  user_id: string;
  question_id: number;
  concept_text: string;
  is_important: boolean;
  saved_at: string;
}

export interface LoginHistory {
  id: number;
  user_id: string;
  ip_address: string | null;
  user_agent: string | null;
  login_at: string;
  is_suspicious: boolean;
}

export interface IpBlocklist {
  id: number;
  ip_address: string;
  reason: string | null;
  blocked_by: string | null;
  blocked_at: string;
}

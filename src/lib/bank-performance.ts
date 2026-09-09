import 'server-only';

import { createClient } from '@/lib/supabase/server';

export interface BankPerformanceCategory {
  category: string;
  answered: number;
  correct: number;
  incorrect: number;
  benchmark_questions?: number;
  accuracy: number | null;
  user_score: number | null;
  peer_average: number | null;
  estimated_percentile: number | null;
}

export interface BankPerformanceDifficulty {
  difficulty: string;
  answered: number;
  correct: number;
  accuracy: number | null;
  peer_average: number | null;
}

export interface BankActivityDay {
  date: string;
  answered: number;
  correct: number;
  accuracy: number | null;
}

export interface BankPerformanceSummary {
  bank_name: string;
  bank_description: string | null;
  total_questions: number;
  answered: number;
  correct: number;
  incorrect: number;
  benchmark_questions: number;
  flagged: number;
  suspended: number;
  completion_percentage: number;
  accuracy: number | null;
  difficulty_adjusted_score: number | null;
  peer_average: number | null;
  estimated_percentile: number | null;
  answered_today: number;
  streak_days: number;
  categories: BankPerformanceCategory[];
  difficulty: BankPerformanceDifficulty[];
  activity: BankActivityDay[];
  method: string;
}

export interface BankSessionSummary {
  id: string;
  started_at: string;
  completed_at: string | null;
  categories: string[] | null;
  total_questions: number;
  session_type: string;
  is_completed: boolean;
  score_percentage: number | null;
  answered_count: number;
}

export class BankPerformanceAccessError extends Error {
  constructor(message = 'Question bank access required') {
    super(message);
    this.name = 'BankPerformanceAccessError';
  }
}

export class BankPerformanceAuthenticationError extends Error {
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'BankPerformanceAuthenticationError';
  }
}

function mapRpcError(error: { message?: string } | null) {
  const message = error?.message || 'Unable to load bank performance';
  if (/authentication required/i.test(message)) {
    throw new BankPerformanceAuthenticationError(message);
  }
  if (/question bank access denied/i.test(message)) {
    throw new BankPerformanceAccessError(message);
  }
  throw new Error(message);
}

export async function getLiveBankPerformance(bankId: number): Promise<BankPerformanceSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_question_bank_performance', { p_bank_id: bankId });
  if (error) mapRpcError(error);

  const value = (data || {}) as Partial<BankPerformanceSummary>;
  return {
    bank_name: String(value.bank_name || 'Question Bank'),
    bank_description: value.bank_description == null ? null : String(value.bank_description),
    total_questions: Number(value.total_questions || 0),
    answered: Number(value.answered || 0),
    correct: Number(value.correct || 0),
    incorrect: Number(value.incorrect || 0),
    benchmark_questions: Number(value.benchmark_questions || 0),
    flagged: Number(value.flagged || 0),
    suspended: Number(value.suspended || 0),
    completion_percentage: Number(value.completion_percentage || 0),
    accuracy: value.accuracy == null ? null : Number(value.accuracy),
    difficulty_adjusted_score: value.difficulty_adjusted_score == null ? null : Number(value.difficulty_adjusted_score),
    peer_average: value.peer_average == null ? null : Number(value.peer_average),
    estimated_percentile: value.estimated_percentile == null ? null : Number(value.estimated_percentile),
    answered_today: Number(value.answered_today || 0),
    streak_days: Number(value.streak_days || 0),
    categories: Array.isArray(value.categories) ? value.categories : [],
    difficulty: Array.isArray(value.difficulty) ? value.difficulty : [],
    activity: Array.isArray(value.activity) ? value.activity : [],
    method: String(value.method || ''),
  };
}

export async function getLiveBankSessions(bankId: number, limit = 100): Promise<BankSessionSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_my_bank_sessions', {
    p_bank_id: bankId,
    p_limit: limit,
  });
  if (error) mapRpcError(error);

  return ((data || []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    started_at: String(row.started_at),
    completed_at: row.completed_at == null ? null : String(row.completed_at),
    categories: Array.isArray(row.categories) ? row.categories.map(String) : null,
    total_questions: Number(row.total_questions || 0),
    session_type: String(row.session_type || 'standard'),
    is_completed: row.is_completed === true,
    score_percentage: row.score_percentage == null ? null : Number(row.score_percentage),
    answered_count: Number(row.answered_count || 0),
  }));
}

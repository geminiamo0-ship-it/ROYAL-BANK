import type { QuestionSelection, SessionType } from '@/types/database';

export interface CategorySummary {
  id: string;
  name: string;
  total: number;
  attempted: number;
}

export interface StartExamInput {
  bankId: number;
  categories: string[];
  topicFilters?: string[];
  difficulties: string[];
  questionSelection: QuestionSelection;
  sessionType?: SessionType;
  limit?: number;
}

export interface ExamClientOption {
  id: number;
  question_id: number;
  text_html: string;
  option_order: number;
}

export interface ExamClientQuestion {
  id: number;
  text_html: string;
  category: string;
  topic: string | null;
  difficulty: string;
  notes_id: string | null;
  concept_id: string | null;
  options?: ExamClientOption[];
}

export interface ExamClientAnswer {
  questionId: number;
  selectedOptionId: number | null;
  isCorrect: boolean | null;
  correctOptionId: number | null;
  timeSpentSeconds: number;
}

export interface ExamQuestionFeedback {
  questionId: number;
  selectedOptionId: number | null;
  isCorrect: boolean;
  correctOptionId: number | null;
  explanationHtml: string;
  optionPercentages: Record<number, number>;
}

export interface ExamTrainingFeedback {
  questionId: number;
  correctOptionId: number | null;
  explanationHtml: string;
  optionPercentages: Record<number, number>;
}

export interface ExamClientSession {
  id: string;
  question_bank_id: number;
  session_type: SessionType;
  time_limit_minutes: number | null;
}

export interface ExamBootstrapSession extends ExamClientSession {
  total_questions: number;
  is_completed: boolean;
  started_at: string | null;
  deadline_at: string | null;
}

export interface ExamBootstrap {
  status: 'active' | 'completed';
  session: ExamBootstrapSession;
  questionIds: number[];
  questions: ExamClientQuestion[];
  answers: Record<number, ExamClientAnswer>;
  flaggedQuestionIds: number[];
  currentIndex: number;
  windowAccessToken: string | null;
  windowAccessExpiresAt: number | null;
  serverNow: string | null;
}

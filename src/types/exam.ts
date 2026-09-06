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

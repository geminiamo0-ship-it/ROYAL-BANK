import type {
  ExamBootstrap,
  ExamClientAnswer,
  ExamClientQuestion,
  ExamQuestionFeedback,
} from '@/types/exam';

export type RawExamSubmitResult = {
  question_id: number;
  selected_option_id: number | null;
  is_correct: boolean | null;
  time_spent_seconds: number | null;
};

export type RawExamSessionAnswer = RawExamSubmitResult & {
  correct_option_id: number | null;
};

export type RawExamQuestionFeedback = {
  question_id: number;
  selected_option_id: number | null;
  is_correct: boolean;
  correct_option_id: number | null;
  explanation_html: string | null;
  option_percentages: Record<string, number> | null;
};

export type RawExamInlineFeedbackResult = {
  answer: RawExamSubmitResult;
  feedback: RawExamQuestionFeedback;
};

export type RawExamBootstrap = {
  status?: string;
  session?: {
    id?: string;
    question_bank_id?: number;
    session_type?: string;
    time_limit_minutes?: number | null;
    total_questions?: number;
    is_completed?: boolean;
  };
  question_ids?: number[];
  questions?: ExamClientQuestion[];
  answers?: RawExamSessionAnswer[];
  flagged_question_ids?: number[];
  current_index?: number;
  window_access_token?: string;
  window_access_expires_at?: number;
};

export function toClientExamAnswer(
  row: RawExamSubmitResult | RawExamSessionAnswer,
): ExamClientAnswer {
  return {
    questionId: Number(row.question_id),
    selectedOptionId: row.selected_option_id == null ? null : Number(row.selected_option_id),
    isCorrect: typeof row.is_correct === 'boolean' ? row.is_correct : null,
    correctOptionId:
      'correct_option_id' in row && row.correct_option_id != null
        ? Number(row.correct_option_id)
        : null,
    timeSpentSeconds: Math.max(0, Number(row.time_spent_seconds || 0)),
  };
}

export function toClientExamFeedback(raw: RawExamQuestionFeedback): ExamQuestionFeedback {
  const optionPercentages: Record<number, number> = {};
  for (const [optionId, percentage] of Object.entries(raw.option_percentages || {})) {
    const parsedOptionId = Number(optionId);
    if (!Number.isFinite(parsedOptionId)) continue;
    optionPercentages[parsedOptionId] = Number(percentage || 0);
  }

  return {
    questionId: Number(raw.question_id),
    selectedOptionId: raw.selected_option_id == null ? null : Number(raw.selected_option_id),
    isCorrect: Boolean(raw.is_correct),
    correctOptionId: raw.correct_option_id == null ? null : Number(raw.correct_option_id),
    explanationHtml: raw.explanation_html || '',
    optionPercentages,
  };
}

export function normalizeExamQuestion(raw: ExamClientQuestion): ExamClientQuestion {
  return {
    id: Number(raw.id),
    text_html: raw.text_html || '',
    category: raw.category || '',
    topic: raw.topic || null,
    difficulty: raw.difficulty || '1',
    notes_id: raw.notes_id || null,
    concept_id: raw.concept_id || null,
    options: (raw.options || [])
      .map((option) => ({
        id: Number(option.id),
        question_id: Number(option.question_id),
        text_html: option.text_html || '',
        option_order: Number(option.option_order || 0),
      }))
      .sort((a, b) => a.option_order - b.option_order || a.id - b.id),
  };
}

export function normalizeExamBootstrap(raw: RawExamBootstrap): ExamBootstrap {
  if (!raw.session?.id) throw new Error('Exam bootstrap did not return a session.');

  const answers: Record<number, ExamClientAnswer> = {};
  for (const row of raw.answers || []) {
    const answer = toClientExamAnswer(row);
    answers[answer.questionId] = answer;
  }

  const rawExpiry = Number(raw.window_access_expires_at || 0);

  return {
    status: raw.status === 'completed' ? 'completed' : 'active',
    session: {
      id: String(raw.session.id),
      question_bank_id: Number(raw.session.question_bank_id || 0),
      session_type: raw.session.session_type as ExamBootstrap['session']['session_type'],
      time_limit_minutes:
        raw.session.time_limit_minutes == null ? null : Number(raw.session.time_limit_minutes),
      total_questions: Math.max(0, Number(raw.session.total_questions || 0)),
      is_completed: Boolean(raw.session.is_completed),
    },
    questionIds: (raw.question_ids || []).map(Number),
    questions: (raw.questions || []).map(normalizeExamQuestion),
    answers,
    flaggedQuestionIds: (raw.flagged_question_ids || []).map(Number),
    currentIndex: Math.max(0, Number(raw.current_index || 0)),
    windowAccessToken:
      typeof raw.window_access_token === 'string' && raw.window_access_token
        ? raw.window_access_token
        : null,
    windowAccessExpiresAt:
      Number.isSafeInteger(rawExpiry) && rawExpiry > 0 ? rawExpiry : null,
  };
}

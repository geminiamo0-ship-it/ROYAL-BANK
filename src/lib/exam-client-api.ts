import { createClient } from '@/lib/supabase/client';
import { decodeTopicFilter } from '@/lib/topic-filters';
import type {
  ExamBootstrap,
  ExamClientAnswer,
  ExamClientQuestion,
  ExamQuestionFeedback,
  StartExamInput,
} from '@/types/exam';

type RawSubmitResult = {
  question_id: number;
  selected_option_id: number | null;
  is_correct: boolean | null;
  time_spent_seconds: number | null;
};

type RawSessionAnswer = RawSubmitResult & {
  correct_option_id: number | null;
};

type RawQuestionFeedback = {
  question_id: number;
  selected_option_id: number | null;
  is_correct: boolean;
  correct_option_id: number | null;
  explanation_html: string | null;
  option_percentages: Record<string, number> | null;
};

type RawInlineFeedbackResult = {
  answer: RawSubmitResult;
  feedback: RawQuestionFeedback;
};

type RawBootstrap = {
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
  answers?: RawSessionAnswer[];
  flagged_question_ids?: number[];
  current_index?: number;
};

const inFlightExamCreates = new Map<string, Promise<ExamBootstrap>>();

function toClientAnswer(row: RawSubmitResult | RawSessionAnswer): ExamClientAnswer {
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

function toClientFeedback(raw: RawQuestionFeedback): ExamQuestionFeedback {
  const optionPercentages: Record<number, number> = {};
  for (const [optionId, percentage] of Object.entries(raw.option_percentages || {})) {
    optionPercentages[Number(optionId)] = Number(percentage || 0);
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

function normalizeQuestion(raw: ExamClientQuestion): ExamClientQuestion {
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

function normalizeBootstrap(raw: RawBootstrap): ExamBootstrap {
  if (!raw.session?.id) throw new Error('Exam bootstrap did not return a session.');

  const answers: Record<number, ExamClientAnswer> = {};
  for (const row of raw.answers || []) {
    const answer = toClientAnswer(row);
    answers[answer.questionId] = answer;
  }

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
    questions: (raw.questions || []).map(normalizeQuestion),
    answers,
    flaggedQuestionIds: (raw.flagged_question_ids || []).map(Number),
    currentIndex: Math.max(0, Number(raw.current_index || 0)),
  };
}

export async function createExamSessionBootstrap(input: StartExamInput): Promise<ExamBootstrap> {
  const parsedTopics: Array<{ category: string; topic: string }> = [];
  const parsedCategories: string[] = [];

  for (const filterValue of [...input.categories, ...(input.topicFilters || [])]) {
    const topicFilter = decodeTopicFilter(filterValue);
    if (topicFilter) parsedTopics.push(topicFilter);
    else parsedCategories.push(filterValue);
  }

  const limit = Math.min(Math.max(input.limit || 70, 1), 70);
  const requestKey = JSON.stringify({
    bankId: input.bankId,
    sessionType: input.sessionType || 'standard',
    limit,
    difficulties: input.difficulties,
    categories: parsedCategories,
    topics: parsedTopics,
    questionSelection: input.questionSelection,
  });

  const existing = inFlightExamCreates.get(requestKey);
  if (existing) return existing;

  const requestId = crypto.randomUUID();
  const request = (async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc('create_exam_session_bootstrap_idempotent', {
      p_request_id: requestId,
      p_bank_id: input.bankId,
      p_session_type: input.sessionType || 'standard',
      p_limit: limit,
      p_difficulties: input.difficulties,
      p_categories: parsedCategories,
      p_topics: parsedTopics,
      p_question_selection: input.questionSelection,
    });

    if (error) throw new Error(error.message);
    if (!data || typeof data !== 'object') throw new Error('Exam bootstrap returned no result.');
    return normalizeBootstrap(data as RawBootstrap);
  })();

  inFlightExamCreates.set(requestKey, request);

  try {
    return await request;
  } finally {
    if (inFlightExamCreates.get(requestKey) === request) {
      inFlightExamCreates.delete(requestKey);
    }
  }
}

export async function getExamSessionBootstrapDirect(sessionId: string): Promise<ExamBootstrap> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('get_exam_session_bootstrap', {
    p_session_id: sessionId,
  });

  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object') throw new Error('Exam bootstrap returned no result.');
  return normalizeBootstrap(data as RawBootstrap);
}

export async function getExamSessionWindowDirect(
  sessionId: string,
  start: number,
  count = 3,
): Promise<ExamClientQuestion[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('get_exam_session_window', {
    p_session_id: sessionId,
    p_start: Math.max(0, Math.floor(start)),
    p_count: Math.min(5, Math.max(1, Math.floor(count))),
  });

  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  return (data as ExamClientQuestion[]).map(normalizeQuestion);
}

export async function submitExamAnswerWithFeedbackDirect(input: {
  sessionId: string;
  questionId: number;
  selectedOptionId: number;
  timeSpentSeconds?: number;
}): Promise<{ answer: ExamClientAnswer; feedback: ExamQuestionFeedback }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('submit_exam_answer_with_feedback', {
    p_session_id: input.sessionId,
    p_question_id: input.questionId,
    p_selected_option_id: input.selectedOptionId,
    p_time_spent_seconds: Math.max(0, Math.floor(input.timeSpentSeconds || 0)),
  });

  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object') throw new Error('Answer feedback was not returned.');

  const raw = data as RawInlineFeedbackResult;
  if (!raw.answer || !raw.feedback) throw new Error('Answer feedback payload is incomplete.');

  const feedback = toClientFeedback(raw.feedback);
  return {
    answer: {
      ...toClientAnswer(raw.answer),
      isCorrect: feedback.isCorrect,
      correctOptionId: feedback.correctOptionId,
    },
    feedback,
  };
}

export async function submitExamAnswerDirect(input: {
  sessionId: string;
  questionId: number;
  selectedOptionId: number;
  timeSpentSeconds?: number;
}): Promise<ExamClientAnswer> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('submit_exam_answer', {
    p_session_id: input.sessionId,
    p_question_id: input.questionId,
    p_selected_option_id: input.selectedOptionId,
    p_time_spent_seconds: Math.max(0, Math.floor(input.timeSpentSeconds || 0)),
  });

  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object') throw new Error('Answer submission returned no result.');
  return toClientAnswer(data as RawSubmitResult);
}

export async function getExamQuestionFeedbackDirect(
  sessionId: string,
  questionId: number,
): Promise<ExamQuestionFeedback> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('get_exam_question_feedback', {
    p_session_id: sessionId,
    p_question_id: questionId,
  });

  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object') throw new Error('Question feedback was not returned.');
  return toClientFeedback(data as RawQuestionFeedback);
}

export async function setQuestionFlagDirect(questionId: number, flagged: boolean): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('set_question_flag', {
    p_question_id: questionId,
    p_flagged: flagged,
  });
  if (error) throw new Error(error.message);
}

export async function completeExamSessionDirect(sessionId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('complete_exam_session', {
    p_session_id: sessionId,
  });
  if (error) throw new Error(error.message);
}

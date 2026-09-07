'use server';

import { createClient } from '@/lib/supabase/server';
import type { ExamClientAnswer, ExamQuestionFeedback } from '@/types/exam';

type RawSubmitResult = {
  question_id: number;
  selected_option_id: number | null;
  is_correct: boolean | null;
  time_spent_seconds: number | null;
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

function toClientAnswer(row: RawSubmitResult): ExamClientAnswer {
  return {
    questionId: Number(row.question_id),
    selectedOptionId: row.selected_option_id == null ? null : Number(row.selected_option_id),
    isCorrect: typeof row.is_correct === 'boolean' ? row.is_correct : null,
    correctOptionId: null,
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

export async function saveUserAnswerWithFeedback(input: {
  sessionId: string;
  questionId: number;
  selectedOptionId: number | null;
  timeSpentSeconds?: number;
}): Promise<{ answer: ExamClientAnswer; feedback: ExamQuestionFeedback }> {
  if (input.selectedOptionId == null) throw new Error('An answer option is required.');

  const supabase = await createClient();
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
  const answer = {
    ...toClientAnswer(raw.answer),
    isCorrect: feedback.isCorrect,
    correctOptionId: feedback.correctOptionId,
  };

  return { answer, feedback };
}

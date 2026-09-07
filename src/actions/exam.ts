'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { decodeTopicFilter } from '@/lib/topic-filters';
import { getLiveQuestionBankCategories } from '@/lib/question-bank';
import type {
  CategorySummary,
  ExamClientAnswer,
  ExamClientQuestion,
  ExamClientSession,
  ExamQuestionFeedback,
  StartExamInput,
} from '@/types/exam';

export type { CategorySummary, StartExamInput } from '@/types/exam';

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

function toClientAnswer(row: RawSessionAnswer | RawSubmitResult): ExamClientAnswer {
  return {
    questionId: Number(row.question_id),
    selectedOptionId: row.selected_option_id == null ? null : Number(row.selected_option_id),
    isCorrect: typeof row.is_correct === 'boolean' ? row.is_correct : null,
    correctOptionId: 'correct_option_id' in row && row.correct_option_id != null
      ? Number(row.correct_option_id)
      : null,
    timeSpentSeconds: Math.max(0, Number(row.time_spent_seconds || 0)),
  };
}

export async function getQuestionBankCategories(bankId: number): Promise<CategorySummary[]> {
  return getLiveQuestionBankCategories(bankId);
}

export async function startExamSession(input: StartExamInput): Promise<string> {
  const supabase = await createClient();

  const parsedTopics: Array<{ category: string; topic: string }> = [];
  const parsedCategories: string[] = [];

  for (const filterValue of [...input.categories, ...(input.topicFilters || [])]) {
    const topicFilter = decodeTopicFilter(filterValue);
    if (topicFilter) parsedTopics.push(topicFilter);
    else parsedCategories.push(filterValue);
  }

  const limit = Math.min(Math.max(input.limit || 70, 1), 70);
  const { data: sessionId, error } = await supabase.rpc('create_exam_session', {
    p_bank_id: input.bankId,
    p_session_type: input.sessionType || 'standard',
    p_limit: limit,
    p_difficulties: input.difficulties,
    p_categories: parsedCategories,
    p_topics: parsedTopics,
    p_question_selection: input.questionSelection,
  });

  if (error) {
    if (error.message.includes('Not authenticated')) redirect('/login');
    throw new Error(error.message);
  }
  if (!sessionId) throw new Error('Exam session was not created.');
  return sessionId as string;
}

export async function getExamSessionQuestions(sessionId: string): Promise<ExamClientQuestion[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: session, error: sessionError } = await supabase
    .from('test_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .eq('is_completed', false)
    .single();

  if (sessionError || !session) throw new Error(sessionError?.message || 'Active session not found');

  const { data: lockedQuestions, error } = await supabase
    .from('test_session_questions')
    .select('sort_order, questions(id, text_html, category, topic, difficulty, notes_id, concept_id, options(id, question_id, text_html, option_order))')
    .eq('test_session_id', sessionId)
    .order('sort_order', { ascending: true });

  if (error) throw new Error(error.message);
  if (!lockedQuestions?.length) throw new Error('Exam session has no locked questions.');

  return (lockedQuestions as Array<{ questions: unknown }>)
    .map((row) => (Array.isArray(row.questions) ? row.questions[0] : row.questions) as ExamClientQuestion | null)
    .filter((question): question is ExamClientQuestion => Boolean(question));
}

export async function saveUserAnswer(input: {
  sessionId: string;
  questionId: number;
  selectedOptionId: number | null;
  timeSpentSeconds?: number;
}): Promise<ExamClientAnswer> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (input.selectedOptionId == null) throw new Error('An answer option is required.');

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

export async function setQuestionFlag(questionId: number, flagged: boolean): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { error } = await supabase.rpc('set_question_flag', {
    p_question_id: questionId,
    p_flagged: flagged,
  });
  if (error) throw new Error(error.message);
}

export async function saveUserNote(questionId: number, noteHtml: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { error } = await supabase.from('user_notes').upsert({
    user_id: user.id,
    question_id: questionId,
    note_html: noteHtml,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,question_id' });
  if (error) throw new Error(error.message);
}

export async function saveConceptVote(input: {
  questionId: number;
  conceptText: string;
  isImportant: boolean;
}): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { error } = await supabase.from('saved_concepts').upsert({
    user_id: user.id,
    question_id: input.questionId,
    concept_text: input.conceptText,
    is_important: input.isImportant,
    saved_at: new Date().toISOString(),
  }, { onConflict: 'user_id,question_id' });
  if (error) throw new Error(error.message);
}

export async function removeSavedConcept(questionId: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { error } = await supabase
    .from('saved_concepts')
    .delete()
    .eq('user_id', user.id)
    .eq('question_id', questionId);
  if (error) throw new Error(error.message);
}

export async function deleteSession(sessionId: string, currentPath: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' };

  const { error } = await supabase
    .from('test_sessions')
    .delete()
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .eq('is_completed', false);

  if (error) return { error: error.message };
  revalidatePath(currentPath);
  return { success: true };
}

export async function getExamSessionAnswers(sessionId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase.rpc('get_exam_session_answers', {
    p_session_id: sessionId,
  });
  if (error) throw new Error(error.message);
  return (data || []) as RawSessionAnswer[];
}

export async function getExamQuestionFeedback(
  sessionId: string,
  questionId: number,
): Promise<ExamQuestionFeedback> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase.rpc('get_exam_question_feedback', {
    p_session_id: sessionId,
    p_question_id: questionId,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object') throw new Error('Question feedback was not returned.');

  const raw = data as RawQuestionFeedback;
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

export async function getExamSession(sessionId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('test_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .single();
  if (error) return null;
  return data;
}

export async function completeExamSession(sessionId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { error } = await supabase.rpc('complete_exam_session', { p_session_id: sessionId });
  if (error) throw new Error(error.message);
}

export async function getFullExamSession(sessionId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data, error } = await supabase
    .from('test_sessions')
    .select('id, question_bank_id, session_type, time_limit_minutes, is_completed, test_session_questions(sort_order, questions(id, text_html, category, topic, difficulty, notes_id, concept_id, options(id, question_id, text_html, option_order)))')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .single();

  if (error || !data) return null;

  const bankId = Number(data.question_bank_id);
  if (!Number.isInteger(bankId) || bankId <= 0) return null;

  if (data.is_completed) {
    return {
      status: 'completed' as const,
      bankId,
    };
  }

  const rows = (data.test_session_questions || []) as Array<{
    sort_order: number;
    questions: ExamClientQuestion | ExamClientQuestion[] | null;
  }>;
  const initialQuestions = rows
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((row) => Array.isArray(row.questions) ? row.questions[0] : row.questions)
    .filter((question): question is ExamClientQuestion => Boolean(question));

  const { data: answerRows, error: answerError } = await supabase.rpc('get_exam_session_answers', {
    p_session_id: sessionId,
  });
  if (answerError) throw new Error(answerError.message);

  const questionIds = initialQuestions.map((question) => question.id);
  let flaggedQuestionIds: number[] = [];

  if (questionIds.length > 0) {
    const { data: flags, error: flagError } = await supabase
      .from('user_question_flags')
      .select('question_id')
      .eq('user_id', user.id)
      .in('question_id', questionIds);

    if (flagError) throw new Error(flagError.message);
    flaggedQuestionIds = (flags || []).map((row) => Number(row.question_id));
  }

  const safeSession: ExamClientSession = {
    id: String(data.id),
    question_bank_id: bankId,
    session_type: data.session_type as ExamClientSession['session_type'],
    time_limit_minutes: data.time_limit_minutes == null ? null : Number(data.time_limit_minutes),
  };

  return {
    status: 'active' as const,
    session: safeSession,
    initialQuestions,
    rawAnswers: (answerRows || []) as RawSessionAnswer[],
    flaggedQuestionIds,
  };
}

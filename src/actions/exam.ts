'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { decodeTopicFilter } from '@/lib/topic-filters';
import { getLiveQuestionBankCategories } from '@/lib/question-bank';
import type { Question } from '@/types/database';
import type { CategorySummary, StartExamInput } from '@/types/exam';

export type { CategorySummary, StartExamInput } from '@/types/exam';

export async function getQuestionBankCategories(bankId: number): Promise<CategorySummary[]> {
  return getLiveQuestionBankCategories(bankId);
}

export async function startExamSession(input: StartExamInput): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const parsedTopics: Array<{ category: string; topic: string }> = [];
  const parsedCategories: string[] = [];

  for (const filterValue of [...input.categories, ...(input.topicFilters || [])]) {
    const topicFilter = decodeTopicFilter(filterValue);
    if (topicFilter) parsedTopics.push(topicFilter);
    else parsedCategories.push(filterValue);
  }

  const limit = Math.min(Math.max(input.limit || 70, 1), 70);
  const { data: sessionId, error } = await supabase.rpc('create_exam_session', {
    p_user_id: user.id,
    p_bank_id: input.bankId,
    p_session_type: input.sessionType || 'standard',
    p_limit: limit,
    p_difficulties: input.difficulties,
    p_categories: parsedCategories,
    p_topics: parsedTopics,
    p_question_selection: input.questionSelection,
  });

  if (error) throw new Error(error.message);
  if (!sessionId) throw new Error('Exam session was not created.');
  return sessionId as string;
}

export async function getExamSessionQuestions(sessionId: string): Promise<Question[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: session, error: sessionError } = await supabase
    .from('test_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .single();

  if (sessionError || !session) throw new Error(sessionError?.message || 'Session not found');

  const { data: lockedQuestions, error } = await supabase
    .from('test_session_questions')
    .select('sort_order, questions(id, text_html, category, topic, difficulty, options(*))')
    .eq('test_session_id', sessionId)
    .order('sort_order', { ascending: true });

  if (error) throw new Error(error.message);
  if (!lockedQuestions?.length) throw new Error('Exam session has no locked questions.');

  return (lockedQuestions as Array<{ questions: unknown }>)
    .map((row) => (Array.isArray(row.questions) ? row.questions[0] : row.questions) as Question | null)
    .filter((question): question is Question => Boolean(question));
}

export async function saveUserAnswer(input: {
  sessionId: string;
  questionId: number;
  selectedOptionId: number | null;
  isCorrect?: boolean;
  isFlagged?: boolean;
  timeSpentSeconds?: number;
}): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (input.selectedOptionId == null) throw new Error('An answer option is required.');

  const { error } = await supabase.rpc('submit_exam_answer', {
    p_session_id: input.sessionId,
    p_question_id: input.questionId,
    p_selected_option_id: input.selectedOptionId,
    p_time_spent_seconds: Math.max(0, Math.floor(input.timeSpentSeconds || 0)),
  });

  if (error) throw new Error(error.message);

  if (typeof input.isFlagged === 'boolean') {
    const { error: flagError } = await supabase.rpc('set_question_flag', {
      p_question_id: input.questionId,
      p_flagged: input.isFlagged,
    });
    if (flagError) throw new Error(flagError.message);
  }
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

  const { data, error } = await supabase
    .from('user_answers')
    .select('*')
    .eq('test_session_id', sessionId)
    .eq('user_id', user.id);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function getQuestionExplanation(questionId: number): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('questions')
    .select('explanation_html')
    .eq('id', questionId)
    .single();
  if (error) throw new Error(error.message);
  return data?.explanation_html || null;
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
    .select('*, test_session_questions(sort_order, questions(id, text_html, category, topic, difficulty, options(*))), user_answers(question_id, selected_option_id, is_correct, time_spent_seconds)')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .single();

  if (error || !data) return null;

  const rows = (data.test_session_questions || []) as Array<{ sort_order: number; questions: Question | Question[] | null }>;
  const initialQuestions = rows
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((row) => Array.isArray(row.questions) ? row.questions[0] : row.questions)
    .filter((question): question is Question => Boolean(question));

  return { session: data, initialQuestions, rawAnswers: data.user_answers || [] };
}

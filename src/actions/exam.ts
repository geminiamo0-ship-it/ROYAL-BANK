'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getBankQuestionRows, type BankQuestionRow } from '@/lib/bank-question-rows';
import { decodeTopicFilter } from '@/lib/topic-filters';
import { getLiveQuestionBankCategories } from '@/lib/question-bank';
import { Option, Question, QuestionSelection, SessionType } from '@/types/database';

interface QuestionIdRow {
  question_id: number | null;
}

interface LockedQuestionRow {
  questions: Question | Question[] | null;
}

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

const DEFAULT_CATEGORIES: CategorySummary[] = [
  { id: 'Cardiology', name: 'Cardiology', total: 694, attempted: 0 },
  { id: 'Clinical Haematology / Oncology', name: 'Clinical haematology/oncology', total: 420, attempted: 0 },
  { id: 'Clinical Pharmacology & Toxicology', name: 'Clinical pharmacology and toxicology', total: 317, attempted: 0 },
  { id: 'Clinical Sciences', name: 'Clinical sciences', total: 571, attempted: 0 },
  { id: 'Dermatology', name: 'Dermatology', total: 257, attempted: 0 },
  { id: 'Endocrinology & Diabetes', name: 'Endocrinology', total: 446, attempted: 0 },
  { id: 'Gastroenterology & Hepatology', name: 'Gastroenterology', total: 413, attempted: 0 },
  { id: 'Geriatric Medicine', name: 'Geriatric medicine', total: 40, attempted: 0 },
  { id: 'Infectious Diseases & STIs', name: 'Infectious diseases and STIs', total: 573, attempted: 0 },
  { id: 'Nephrology & Renal Medicine', name: 'Nephrology', total: 275, attempted: 0 },
  { id: 'Neurology', name: 'Neurology', total: 554, attempted: 0 },
  { id: 'Ophthalmology', name: 'Ophthalmology', total: 100, attempted: 0 },
  { id: 'Palliative Medicine', name: 'Palliative medicine and end of life care', total: 38, attempted: 0 },
  { id: 'Psychiatry', name: 'Psychiatry', total: 132, attempted: 0 },
  { id: 'Respiratory Medicine', name: 'Respiratory medicine', total: 265, attempted: 0 },
  { id: 'Rheumatology', name: 'Rheumatology', total: 352, attempted: 0 },
];


export async function getQuestionBankCategories(bankId: number): Promise<CategorySummary[]> {
  return getLiveQuestionBankCategories(bankId);
}

export async function startExamSession(input: StartExamInput): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // ==== Backend Authorization Check ====
  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, role')
    .eq('id', user.id)
    .single();

  const tier = profile?.subscription_tier || 'free_trial';
  const isPremium = tier === 'premium_full' || profile?.role === 'admin' || profile?.role === 'support';

  // Bank ID 1 is MRCP Part 1. We allow Free Trial only on Bank ID 1.
  if (!isPremium && input.bankId !== 1) {
    throw new Error("Unauthorized: Premium subscription required to access this bank.");
  }
  // =====================================

  const limit = Math.min(Math.max(input.limit || 70, 1), 70);
  const categories = [...input.categories, ...(input.topicFilters || [])];
  const categoryFilters = categories.length > 0 ? categories : null;
  const difficulties = input.difficulties.length > 0 ? input.difficulties : null;

  // ==== Fetch available questions for this session ====
  let query = supabase
    .from('questions')
    .select('id')
    .order('id', { ascending: true })
    .limit(limit);

  let mappedQuestionIds: number[] | null = null;
  if (input.bankId && input.bankId !== 1) {
    const { data: mappings } = await supabase
      .from('question_bank_questions')
      .select('question_id')
      .eq('question_bank_id', input.bankId);
    if (mappings && mappings.length > 0) {
      mappedQuestionIds = mappings
        .map((row: QuestionIdRow) => row.question_id)
        .filter((questionId): questionId is number => typeof questionId === 'number');
      query = query.in('id', mappedQuestionIds);
    } else {
      query = query.in('id', [-1]); // Empty bank
    }
  }

  // Handle Categories & Topics
  const fullCategoryFilters: string[] = [];
  const topicFilters: Array<{ category: string; topic: string }> = [];

  for (const filterValue of categories) {
    const topicFilter = decodeTopicFilter(filterValue);
    if (topicFilter) {
      topicFilters.push(topicFilter);
    } else {
      fullCategoryFilters.push(filterValue);
    }
  }

  if (topicFilters.length > 0 || fullCategoryFilters.length > 0) {
    const orConditions = [];
    if (fullCategoryFilters.length > 0) {
      const catsStr = fullCategoryFilters.map(c => `"${c.replace(/"/g, '""')}"`).join(',');
      orConditions.push(`category.in.(${catsStr})`);
    }
    if (topicFilters.length > 0) {
      for (const tf of topicFilters) {
        orConditions.push(`and(category.eq."${tf.category.replace(/"/g, '""')}",topic.eq."${tf.topic.replace(/"/g, '""')}")`);
      }
    }
    if (orConditions.length > 0) {
      query = query.or(orConditions.join(','));
    }
  }

  if (difficulties && difficulties.length > 0) {
    query = query.in('difficulty', difficulties);
  }

  // Handle "New Only" logic (exclude answered AND suspended)
  if (input.questionSelection === 'new_only') {
    const [{ data: answered }, { data: activeSessions }] = await Promise.all([
      supabase.from('user_answers').select('question_id').eq('user_id', user.id),
      supabase.from('test_sessions').select('id').eq('user_id', user.id).eq('is_completed', false),
    ]);

    const activeSessionIds = (activeSessions || [])
      .map((session) => session.id)
      .filter((sessionId): sessionId is string => typeof sessionId === 'string');

    const { data: suspendedDirect } = activeSessionIds.length
      ? await supabase
          .from('test_session_questions')
          .select('question_id')
          .in('test_session_id', activeSessionIds)
      : { data: [] as QuestionIdRow[] };

    const excludedIds = new Set<number>();
    (answered || []).forEach((answer: QuestionIdRow) => {
      if (typeof answer.question_id === 'number') excludedIds.add(answer.question_id);
    });
    (suspendedDirect || []).forEach((lock: QuestionIdRow) => {
      if (typeof lock.question_id === 'number') excludedIds.add(lock.question_id);
    });

    if (excludedIds.size > 0) {
      const excludedArray = Array.from(excludedIds);
      query = query.not('id', 'in', `(${excludedArray.join(',')})`);
    }
  } else if (input.questionSelection === 'incorrect_only') {
    const { data: incorrect } = await supabase.from('user_answers').select('question_id').eq('user_id', user.id).eq('is_correct', false);
    const incorrectIds = (incorrect || [])
      .map((answer: QuestionIdRow) => answer.question_id)
      .filter((questionId): questionId is number => typeof questionId === 'number');
    if (incorrectIds.length > 0) {
      query = query.in('id', incorrectIds);
    } else {
      query = query.in('id', [-1]);
    }
  } else if (input.questionSelection === 'flagged_only') {
    const { data: flagged } = await supabase.from('user_answers').select('question_id').eq('user_id', user.id).eq('is_flagged', true);
    const flaggedIds = (flagged || [])
      .map((answer: QuestionIdRow) => answer.question_id)
      .filter((questionId): questionId is number => typeof questionId === 'number');
    if (flaggedIds.length > 0) {
      query = query.in('id', flaggedIds);
    } else {
      query = query.in('id', [-1]);
    }
  } else if (input.questionSelection === 'suspended_only') {
    // Only include questions that are locked in test_session_questions
    const { data: suspendedDirect } = await supabase.from('test_session_questions').select('question_id');
    const suspendedIds = (suspendedDirect || []).map(a => a.question_id).filter(Boolean);
    if (suspendedIds.length > 0) {
      query = query.in('id', suspendedIds);
    } else {
      query = query.in('id', [-1]);
    }
  }

  const { data: matchedQuestions, error: fetchError } = await query;
  if (fetchError) {
    throw new Error(fetchError.message);
  }
  
  const finalLimit = Math.min(limit, matchedQuestions?.length || 0);

  const { data, error } = await supabase
    .from('test_sessions')
    .insert({
      user_id: user.id,
      question_bank_id: input.bankId,
      session_type: input.sessionType || 'standard',
      categories: categoryFilters,
      difficulty_filter: difficulties,
      question_selection: input.questionSelection,
      total_questions: finalLimit, // Use actual count
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  // Lock the questions into test_session_questions
  if (matchedQuestions && matchedQuestions.length > 0) {
    const payload = matchedQuestions.slice(0, finalLimit).map((mq, index) => ({
      test_session_id: data.id,
      question_id: mq.id,
      sort_order: index,
    }));
    const { error: lockError } = await supabase.from('test_session_questions').insert(payload);
    if (lockError) {
      console.error('Failed to lock questions:', lockError);
    }
  }

  return data.id;
}

export async function getExamSessionQuestions(sessionId: string): Promise<Question[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: session, error: sessionError } = await supabase
    .from('test_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .single();

  if (sessionError) {
    throw new Error(sessionError.message);
  }

  // ==== NEW LOGIC: Fetch locked questions ====
  const { data: lockedQuestions, error: lockedError } = await supabase
    .from('test_session_questions')
    .select('sort_order, questions(id, text_html, category, topic, difficulty, options(*))')
    .eq('test_session_id', sessionId)
    .order('sort_order', { ascending: true });

  if (lockedError) {
    throw new Error(lockedError.message);
  }

  if (lockedQuestions && lockedQuestions.length > 0) {
    return (lockedQuestions as any[])
      .map((row) => Array.isArray(row.questions) ? row.questions[0] : row.questions)
      .filter(Boolean) as Question[];
  }

  // ==== LEGACY LOGIC: Fallback for old sessions created before test_session_questions ====
  let mappedQuestionIds: number[] | null = null;
  if (session.question_bank_id && session.question_bank_id !== 1) {
    const { data: mappings } = await supabase
      .from('question_bank_questions')
      .select('question_id')
      .eq('question_bank_id', session.question_bank_id);

    if (mappings && mappings.length > 0) {
      mappedQuestionIds = mappings.map((row) => row.question_id).filter(Boolean);
    }
  }

  let query = supabase
    .from('questions')
    .select('id, text_html, category, topic, difficulty, options(*)')
    .order('id', { ascending: true })
    .limit(session.total_questions || 70);

  if (mappedQuestionIds && mappedQuestionIds.length > 0) {
    query = query.in('id', mappedQuestionIds);
  }

  const fullCategoryFilters: string[] = [];
  const topicFilters: Array<{ category: string; topic: string }> = [];

  for (const filterValue of session.categories || []) {
    const topicFilter = decodeTopicFilter(filterValue);
    if (topicFilter) {
      topicFilters.push(topicFilter);
      continue;
    }

    fullCategoryFilters.push(filterValue);
  }

  if (topicFilters.length > 0 || fullCategoryFilters.length > 0) {
    const orConditions = [];
    if (fullCategoryFilters.length > 0) {
      const catsStr = fullCategoryFilters.map(c => `"${c.replace(/"/g, '""')}"`).join(',');
      orConditions.push(`category.in.(${catsStr})`);
    }
    if (topicFilters.length > 0) {
      for (const tf of topicFilters) {
        orConditions.push(`and(category.eq."${tf.category.replace(/"/g, '""')}",topic.eq."${tf.topic.replace(/"/g, '""')}")`);
      }
    }
    
    if (orConditions.length > 0) {
      query = query.or(orConditions.join(','));
    }
  }

  if (session.difficulty_filter?.length) {
    query = query.in('difficulty', session.difficulty_filter);
  }

  if (session.question_selection === 'new_only') {
    const { data: attempts } = await supabase
      .from('user_answers')
      .select('question_id')
      .eq('user_id', user.id);

    const attemptedIds = (attempts || []).map((row) => row.question_id).filter(Boolean);
    if (attemptedIds.length > 0) {
      query = query.not('id', 'in', `(${attemptedIds.join(',')})`);
    }
  }

  if (session.question_selection === 'incorrect_only') {
    const { data: attempts } = await supabase
      .from('user_answers')
      .select('question_id')
      .eq('user_id', user.id)
      .eq('is_correct', false);

    const incorrectIds = Array.from(new Set((attempts || []).map((row) => row.question_id).filter(Boolean)));
    if (incorrectIds.length === 0) return [];
    query = query.in('id', incorrectIds);
  }

  if (session.question_selection === 'flagged_only') {
    const { data: attempts } = await supabase
      .from('user_answers')
      .select('question_id')
      .eq('user_id', user.id)
      .eq('is_flagged', true);

    const flaggedIds = Array.from(new Set((attempts || []).map((row) => row.question_id).filter(Boolean)));
    if (flaggedIds.length === 0) return [];
    query = query.in('id', flaggedIds);
  }

  const { data: questions, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  const qList = (questions || []) as (Question & { options?: Option[] })[];
  const missingOptionsQIds = qList
    .filter((q) => !q.options || q.options.length === 0)
    .map((q) => q.id);

  const extraOptionsByQId = new Map<number, Option[]>();
  if (missingOptionsQIds.length > 0) {
    const { data: optRows } = await supabase
      .from('options')
      .select('*')
      .in('question_id', missingOptionsQIds)
      .order('option_order', { ascending: true });

    for (const opt of optRows || []) {
      const existing = extraOptionsByQId.get(opt.question_id) || [];
      existing.push(opt as Option);
      extraOptionsByQId.set(opt.question_id, existing);
    }
  }

  return qList.map((question) => {
    const opts = (question.options && question.options.length > 0)
      ? question.options
      : (extraOptionsByQId.get(question.id) || []);

    return {
      ...question,
      options: [...opts].sort((a, b) => a.option_order - b.option_order),
    };
  }) as Question[];
}

export async function saveUserAnswer(input: {
  sessionId: string;
  questionId: number;
  selectedOptionId: number | null;
  isCorrect: boolean;
  isFlagged?: boolean;
  timeSpentSeconds?: number;
}): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const payload = {
    test_session_id: input.sessionId,
    user_id: user.id,
    question_id: input.questionId,
    selected_option_id: input.selectedOptionId,
    is_correct: input.isCorrect,
    is_flagged: input.isFlagged || false,
    time_spent_seconds: input.timeSpentSeconds || 0,
  };

  const { error } = await supabase.from('user_answers').insert(payload);

  if (error) {
    // If foreign key constraint failed on option, fallback to inserting without option FK
    if (error.message.includes('foreign key constraint')) {
      await supabase.from('user_answers').insert({
        ...payload,
        selected_option_id: null,
      });
    }
  }
}

export async function saveUserNote(questionId: number, noteHtml: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { error } = await supabase.from('user_notes').upsert({
    user_id: user.id,
    question_id: questionId,
    note_html: noteHtml,
    updated_at: new Date().toISOString(),
  }, {
    onConflict: 'user_id,question_id',
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function saveConceptVote(input: {
  questionId: number;
  conceptText: string;
  isImportant: boolean;
}): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { error } = await supabase.from('saved_concepts').upsert({
    user_id: user.id,
    question_id: input.questionId,
    concept_text: input.conceptText,
    is_important: input.isImportant,
    saved_at: new Date().toISOString(),
  }, {
    onConflict: 'user_id,question_id',
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function removeSavedConcept(questionId: number): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { error } = await supabase
    .from('saved_concepts')
    .delete()
    .eq('user_id', user.id)
    .eq('question_id', questionId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function deleteSession(sessionId: string, currentPath: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' };

  const { error } = await supabase
    .from('test_sessions')
    .delete()
    .eq('id', sessionId)
    .eq('user_id', user.id);

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
  return data || [];
}
export async function getQuestionExplanation(questionId: number): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Not authenticated');
  }

  const { data, error } = await supabase
    .from('questions')
    .select('explanation_html')
    .eq('id', questionId)
    .single();

  if (error) {
    console.error('Error fetching explanation:', error);
    return null;
  }

  return data?.explanation_html || null;
}

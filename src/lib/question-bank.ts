import 'server-only';

import type { CategorySummary } from '@/actions/exam';
import { getBankQuestionRows, type BankQuestionRow } from '@/lib/bank-question-rows';
import { createClient } from '@/lib/supabase/server';
import type { CategoryWithTopics } from '@/types/question-bank';

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

// We group counts for a single user internally by a key like `Category|||Topic`
type UserStateCounts = {
  attempted: number;
  incorrect: number;
  flagged: number;
  suspended: number;
};

async function getUserQuestionStateMap() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const stateMap = new Map<string, UserStateCounts>();

  const getOrCreate = (cat: string, top: string | null) => {
    const key = top ? `${cat}|||${top}` : cat;
    if (!stateMap.has(key)) {
      stateMap.set(key, { attempted: 0, incorrect: 0, flagged: 0, suspended: 0 });
    }
    return stateMap.get(key)!;
  };

  if (!user) {
    return stateMap;
  }

  // Fetch answers and active sessions concurrently
  const [
    { data: answers },
    { data: activeSessions }
  ] = await Promise.all([
    supabase
      .from('user_answers')
      .select('is_correct, is_flagged, questions!inner(category, topic)')
      .eq('user_id', user.id),
    supabase
      .from('test_sessions')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_completed', false)
  ]);

  for (const answer of answers || []) {
    // relation is technically array or object depending on PostgREST, but since it's an inner join to a single row, it's usually an object.
    const qInfo = Array.isArray(answer.questions) ? answer.questions[0] : answer.questions;
    if (!qInfo?.category) continue;

    const state = getOrCreate(qInfo.category, qInfo.topic);
    state.attempted += 1;
    
    // Also add to the parent category if there's a topic
    if (qInfo.topic) {
      const parentState = getOrCreate(qInfo.category, null);
      parentState.attempted += 1;
      if (answer.is_correct === false) parentState.incorrect += 1;
      if (answer.is_flagged === true) parentState.flagged += 1;
    }

    if (answer.is_correct === false) state.incorrect += 1;
    if (answer.is_flagged === true) state.flagged += 1;
  }

  const activeSessionIds = (activeSessions || []).map(s => s.id);

  if (activeSessionIds.length > 0) {
    const { data: suspended } = await supabase
      .from('test_session_questions')
      .select('questions!inner(category, topic)')
      .in('test_session_id', activeSessionIds);

    for (const lock of suspended || []) {
      const qInfo = Array.isArray(lock.questions) ? lock.questions[0] : lock.questions;
      if (!qInfo?.category) continue;

      const state = getOrCreate(qInfo.category, qInfo.topic);
      state.suspended += 1;
      state.attempted += 1; // Count suspended as attempted to subtract from newCount

      if (qInfo.topic) {
        const parentState = getOrCreate(qInfo.category, null);
        parentState.suspended += 1;
        parentState.attempted += 1;
      }
    }
  }

  return stateMap;
}

function buildQuestionBankOutline(
  rows: BankQuestionRow[],
  userStateMap: Map<string, UserStateCounts>
) {
  const categoryMap = new Map<
    string,
    {
      name: string;
      total: number;
      attempted: number;
      incorrectCount: number;
      flaggedCount: number;
      suspendedCount: number;
      topics: Map<
        string,
        {
          total: number;
          attempted: number;
          incorrectCount: number;
          flaggedCount: number;
          suspendedCount: number;
        }
      >;
    }
  >();

  for (const row of rows) {
    const existing =
      categoryMap.get(row.category) ||
      {
        name: row.category,
        total: 0,
        attempted: 0,
        incorrectCount: 0,
        flaggedCount: 0,
        suspendedCount: 0,
        topics: new Map(),
      };

    // The RPC returns `total_questions` for this specific `category` and `topic` combination
    existing.total += Number(row.total_questions) || 0;
    
    // We already calculated the parent category's user states in `getUserQuestionStateMap`
    // However, it's safer to just let the user state map provide the totals. 
    // We don't add to `existing.attempted` here because the user state map holds the pre-aggregated values.

    if (row.topic) {
      const topicState = userStateMap.get(`${row.category}|||${row.topic}`) || { attempted: 0, incorrect: 0, flagged: 0, suspended: 0 };
      
      existing.topics.set(row.topic, {
        total: Number(row.total_questions) || 0,
        attempted: topicState.attempted,
        incorrectCount: topicState.incorrect,
        flaggedCount: topicState.flagged,
        suspendedCount: topicState.suspended,
      });
    } else {
      // If there's no topic, these are questions directly at the category level
    }

    categoryMap.set(row.category, existing);
  }

  // Now apply the pre-aggregated parent category user state to the categories
  for (const [category, summary] of categoryMap.entries()) {
    const catState = userStateMap.get(category) || { attempted: 0, incorrect: 0, flagged: 0, suspended: 0 };
    summary.attempted = catState.attempted;
    summary.incorrectCount = catState.incorrect;
    summary.flaggedCount = catState.flagged;
    summary.suspendedCount = catState.suspended;
  }

  return Array.from(categoryMap.entries())
    .map(([category, summary]) => ({
      id: category,
      name: summary.name,
      total: summary.total,
      attempted: summary.attempted,
      newCount: Math.max(summary.total - summary.attempted, 0),
      incorrectCount: summary.incorrectCount,
      flaggedCount: summary.flaggedCount,
      suspendedCount: summary.suspendedCount,
      topics: Array.from(summary.topics.entries())
        .map(([topic, topicSummary]) => ({
          id: topic,
          name: topic,
          total: topicSummary.total,
          attempted: topicSummary.attempted,
          newCount: Math.max(topicSummary.total - topicSummary.attempted, 0),
          incorrectCount: topicSummary.incorrectCount,
          flaggedCount: topicSummary.flaggedCount,
          suspendedCount: topicSummary.suspendedCount,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getLiveQuestionBankOutline(bankId: number): Promise<CategoryWithTopics[]> {
  try {
    const [rows, userStateMap] = await Promise.all([
      getBankQuestionRows(bankId),
      getUserQuestionStateMap(),
    ]);
    
    const outline = buildQuestionBankOutline(rows, userStateMap);
    
    return outline.length > 0
      ? outline
      : DEFAULT_CATEGORIES.map((category) => ({
          ...category,
          newCount: category.total,
          incorrectCount: 0,
          flaggedCount: 0,
          suspendedCount: 0,
          topics: [],
        }));
  } catch (err) {
    console.error('Error in getLiveQuestionBankOutline:', err);
    return DEFAULT_CATEGORIES.map((category) => ({
      ...category,
      newCount: category.total,
      incorrectCount: 0,
      flaggedCount: 0,
      suspendedCount: 0,
      topics: [],
    }));
  }
}

export async function getLiveQuestionBankCategories(bankId: number): Promise<CategorySummary[]> {
  const outline = await getLiveQuestionBankOutline(bankId);
  return outline.map((category) => ({
    id: category.id,
    name: category.name,
    total: category.total,
    attempted: category.attempted,
  }));
}

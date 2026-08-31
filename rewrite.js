const fs = require('fs');

const code = import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getBankQuestionRows, type BankQuestionRow } from '@/lib/bank-question-rows';
import { CategorySummary, CategoryWithTopics, DifficultyCounts } from '@/types/question-bank';

export const DEFAULT_CATEGORIES = [
  { id: 'Cardiology', name: 'Cardiology', total: 604, attempted: 0 },
  { id: 'Clinical Pharmacology', name: 'Clinical pharmacology, therapeutics and toxicology', total: 541, attempted: 0 },
  { id: 'Endocrinology', name: 'Endocrinology', total: 396, attempted: 0 },
  { id: 'Gastroenterology', name: 'Gastroenterology', total: 479, attempted: 0 },
  { id: 'Geriatric Medicine', name: 'Geriatric medicine', total: 104, attempted: 0 },
  { id: 'Haematology', name: 'Haematology', total: 301, attempted: 0 },
  { id: 'Infectious Diseases & STIs', name: 'Infectious diseases and STIs', total: 573, attempted: 0 },
  { id: 'Nephrology & Renal Medicine', name: 'Nephrology', total: 275, attempted: 0 },
  { id: 'Neurology', name: 'Neurology', total: 554, attempted: 0 },
  { id: 'Ophthalmology', name: 'Ophthalmology', total: 100, attempted: 0 },
  { id: 'Palliative Medicine', name: 'Palliative medicine and end of life care', total: 38, attempted: 0 },
  { id: 'Psychiatry', name: 'Psychiatry', total: 132, attempted: 0 },
  { id: 'Respiratory Medicine', name: 'Respiratory medicine', total: 265, attempted: 0 },
  { id: 'Rheumatology', name: 'Rheumatology', total: 352, attempted: 0 },
];

const createEmptyCounts = (): DifficultyCounts => ({ '1': 0, '2': 0, '3': 0 });

type UserStateCounts = {
  attempted: DifficultyCounts;
  incorrect: DifficultyCounts;
  flagged: DifficultyCounts;
  suspended: DifficultyCounts;
};

async function getUserQuestionStateMap() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const stateMap = new Map<string, UserStateCounts>();

  const getOrCreate = (cat: string, top: string | null) => {
    const key = top ? \\\\|||\\\\ : cat;
    if (!stateMap.has(key)) {
      stateMap.set(key, { 
        attempted: createEmptyCounts(), 
        incorrect: createEmptyCounts(), 
        flagged: createEmptyCounts(), 
        suspended: createEmptyCounts() 
      });
    }
    return stateMap.get(key)!;
  };

  if (!user) {
    return stateMap;
  }

  const [
    { data: answers },
    { data: activeSessions }
  ] = await Promise.all([
    supabase
      .from('user_answers')
      .select('is_correct, is_flagged, questions!inner(category, topic, difficulty)')
      .eq('user_id', user.id),
    supabase
      .from('test_sessions')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_completed', false)
  ]);

  for (const answer of answers || []) {
    const qInfo = Array.isArray(answer.questions) ? answer.questions[0] : answer.questions;
    if (!qInfo?.category) continue;
    const d = qInfo.difficulty || '1';

    const state = getOrCreate(qInfo.category, qInfo.topic);
    state.attempted[d] = (state.attempted[d] || 0) + 1;
    if (answer.is_correct === false) state.incorrect[d] = (state.incorrect[d] || 0) + 1;
    if (answer.is_flagged === true) state.flagged[d] = (state.flagged[d] || 0) + 1;
    
    if (qInfo.topic) {
      const parentState = getOrCreate(qInfo.category, null);
      parentState.attempted[d] = (parentState.attempted[d] || 0) + 1;
      if (answer.is_correct === false) parentState.incorrect[d] = (parentState.incorrect[d] || 0) + 1;
      if (answer.is_flagged === true) parentState.flagged[d] = (parentState.flagged[d] || 0) + 1;
    }
  }

  const activeSessionIds = (activeSessions || []).map(s => s.id);

  if (activeSessionIds.length > 0) {
    const { data: suspended } = await supabase
      .from('test_session_questions')
      .select('questions!inner(category, topic, difficulty)')
      .in('test_session_id', activeSessionIds);

    for (const lock of suspended || []) {
      const qInfo = Array.isArray(lock.questions) ? lock.questions[0] : lock.questions;
      if (!qInfo?.category) continue;
      const d = qInfo.difficulty || '1';

      const state = getOrCreate(qInfo.category, qInfo.topic);
      state.suspended[d] = (state.suspended[d] || 0) + 1;
      state.attempted[d] = (state.attempted[d] || 0) + 1; 

      if (qInfo.topic) {
        const parentState = getOrCreate(qInfo.category, null);
        parentState.suspended[d] = (parentState.suspended[d] || 0) + 1;
        parentState.attempted[d] = (parentState.attempted[d] || 0) + 1;
      }
    }
  }

  return stateMap;
}

function sumCounts(counts: DifficultyCounts): number {
  return (counts['1'] || 0) + (counts['2'] || 0) + (counts['3'] || 0);
}

function buildQuestionBankOutline(
  rows: BankQuestionRow[],
  userStateMap: Map<string, UserStateCounts>
) {
  const categoryMap = new Map<string, any>();

  for (const row of rows) {
    const d = row.difficulty || '1';
    let existing = categoryMap.get(row.category);
    if (!existing) {
      existing = {
        name: row.category,
        totalByDiff: createEmptyCounts(),
        topics: new Map(),
      };
      categoryMap.set(row.category, existing);
    }

    existing.totalByDiff[d] = (existing.totalByDiff[d] || 0) + (Number(row.total_questions) || 0);
    
    if (row.topic) {
      let topicObj = existing.topics.get(row.topic);
      if (!topicObj) {
        topicObj = { totalByDiff: createEmptyCounts() };
        existing.topics.set(row.topic, topicObj);
      }
      topicObj.totalByDiff[d] = (topicObj.totalByDiff[d] || 0) + (Number(row.total_questions) || 0);
    }
  }

  return Array.from(categoryMap.entries())
    .map(([category, summary]) => {
      const catState = userStateMap.get(category) || { attempted: createEmptyCounts(), incorrect: createEmptyCounts(), flagged: createEmptyCounts(), suspended: createEmptyCounts() };
      
      const topics = Array.from(summary.topics.entries()).map(([topic, topicSummary]: [string, any]) => {
        const topicState = userStateMap.get(\\|||\\) || { attempted: createEmptyCounts(), incorrect: createEmptyCounts(), flagged: createEmptyCounts(), suspended: createEmptyCounts() };
        
        return {
          id: topic,
          name: topic,
          total: sumCounts(topicSummary.totalByDiff),
          attempted: sumCounts(topicState.attempted),
          newCount: Math.max(sumCounts(topicSummary.totalByDiff) - sumCounts(topicState.attempted), 0),
          incorrectCount: sumCounts(topicState.incorrect),
          flaggedCount: sumCounts(topicState.flagged),
          suspendedCount: sumCounts(topicState.suspended),
          totalByDiff: topicSummary.totalByDiff,
          attemptedByDiff: topicState.attempted,
          incorrectByDiff: topicState.incorrect,
          flaggedByDiff: topicState.flagged,
          suspendedByDiff: topicState.suspended,
        };
      }).sort((a, b) => a.name.localeCompare(b.name));

      return {
        id: category,
        name: summary.name,
        total: sumCounts(summary.totalByDiff),
        attempted: sumCounts(catState.attempted),
        newCount: Math.max(sumCounts(summary.totalByDiff) - sumCounts(catState.attempted), 0),
        incorrectCount: sumCounts(catState.incorrect),
        flaggedCount: sumCounts(catState.flagged),
        suspendedCount: sumCounts(catState.suspended),
        totalByDiff: summary.totalByDiff,
        attemptedByDiff: catState.attempted,
        incorrectByDiff: catState.incorrect,
        flaggedByDiff: catState.flagged,
        suspendedByDiff: catState.suspended,
        topics
      };
    })
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
          totalByDiff: createEmptyCounts(),
          attemptedByDiff: createEmptyCounts(),
          incorrectByDiff: createEmptyCounts(),
          flaggedByDiff: createEmptyCounts(),
          suspendedByDiff: createEmptyCounts(),
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
      totalByDiff: createEmptyCounts(),
      attemptedByDiff: createEmptyCounts(),
      incorrectByDiff: createEmptyCounts(),
      flaggedByDiff: createEmptyCounts(),
      suspendedByDiff: createEmptyCounts(),
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
;
fs.writeFileSync('src/lib/question-bank.ts', code);

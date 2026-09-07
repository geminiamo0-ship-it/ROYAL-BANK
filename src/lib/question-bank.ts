import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { CategoryWithTopics, DifficultyCounts } from '@/types/question-bank';
import type { CategorySummary } from '@/types/exam';

const createEmptyCounts = (): DifficultyCounts => ({ '1': 0, '2': 0, '3': 0 });

type PrecomputedDashboardRow = {
  category: string;
  topic: string | null;
  difficulty: string;
  total_questions: number;
  attempted_count: number;
  incorrect_count: number;
  flagged_count: number;
  suspended_count: number;
  new_count: number;
};

type PrecomputedCounts = {
  total: DifficultyCounts;
  attempted: DifficultyCounts;
  incorrect: DifficultyCounts;
  flagged: DifficultyCounts;
  suspended: DifficultyCounts;
  newQuestions: DifficultyCounts;
};

type PrecomputedCategory = {
  name: string;
  counts: PrecomputedCounts;
  topics: Map<string, PrecomputedCounts>;
};

export class QuestionBankAccessError extends Error {
  constructor(message = 'Question bank access required') {
    super(message);
    this.name = 'QuestionBankAccessError';
  }
}

export class QuestionBankAuthenticationError extends Error {
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'QuestionBankAuthenticationError';
  }
}

const emptyPrecomputedCounts = (): PrecomputedCounts => ({
  total: createEmptyCounts(),
  attempted: createEmptyCounts(),
  incorrect: createEmptyCounts(),
  flagged: createEmptyCounts(),
  suspended: createEmptyCounts(),
  newQuestions: createEmptyCounts(),
});

function sumCounts(counts: DifficultyCounts): number {
  return counts['1'] + counts['2'] + counts['3'];
}

function addPrecomputedRow(
  counts: PrecomputedCounts,
  row: PrecomputedDashboardRow,
  difficulty: string,
) {
  counts.total[difficulty] += Number(row.total_questions) || 0;
  counts.attempted[difficulty] += Number(row.attempted_count) || 0;
  counts.incorrect[difficulty] += Number(row.incorrect_count) || 0;
  counts.flagged[difficulty] += Number(row.flagged_count) || 0;
  counts.suspended[difficulty] += Number(row.suspended_count) || 0;
  counts.newQuestions[difficulty] += Number(row.new_count) || 0;
}

function buildPrecomputedQuestionBankOutline(
  rows: PrecomputedDashboardRow[],
): CategoryWithTopics[] {
  const categoryMap = new Map<string, PrecomputedCategory>();

  for (const row of rows) {
    const category = String(row.category || '').trim();
    const difficulty = String(row.difficulty || '1');
    if (!category || !(difficulty in createEmptyCounts())) continue;

    let summary = categoryMap.get(category);
    if (!summary) {
      summary = {
        name: category,
        counts: emptyPrecomputedCounts(),
        topics: new Map(),
      };
      categoryMap.set(category, summary);
    }

    addPrecomputedRow(summary.counts, row, difficulty);

    if (row.topic) {
      let topicCounts = summary.topics.get(row.topic);
      if (!topicCounts) {
        topicCounts = emptyPrecomputedCounts();
        summary.topics.set(row.topic, topicCounts);
      }
      addPrecomputedRow(topicCounts, row, difficulty);
    }
  }

  return Array.from(categoryMap.entries())
    .map(([category, summary]) => ({
      id: category,
      name: summary.name,
      total: sumCounts(summary.counts.total),
      attempted: sumCounts(summary.counts.attempted),
      newCount: sumCounts(summary.counts.newQuestions),
      incorrectCount: sumCounts(summary.counts.incorrect),
      flaggedCount: sumCounts(summary.counts.flagged),
      suspendedCount: sumCounts(summary.counts.suspended),
      totalByDiff: summary.counts.total,
      attemptedByDiff: summary.counts.attempted,
      incorrectByDiff: summary.counts.incorrect,
      flaggedByDiff: summary.counts.flagged,
      suspendedByDiff: summary.counts.suspended,
      topics: Array.from(summary.topics.entries())
        .map(([topic, counts]) => ({
          id: topic,
          name: topic,
          total: sumCounts(counts.total),
          attempted: sumCounts(counts.attempted),
          newCount: sumCounts(counts.newQuestions),
          incorrectCount: sumCounts(counts.incorrect),
          flaggedCount: sumCounts(counts.flagged),
          suspendedCount: sumCounts(counts.suspended),
          totalByDiff: counts.total,
          attemptedByDiff: counts.attempted,
          incorrectByDiff: counts.incorrect,
          flaggedByDiff: counts.flagged,
          suspendedByDiff: counts.suspended,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getLiveQuestionBankOutline(bankId: number): Promise<CategoryWithTopics[]> {
  // The dashboard RPC is the authorization boundary and the data read in one call.
  // It validates auth/access internally and normally serves a precomputed user/bank payload.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_question_bank_dashboard', {
    p_bank_id: bankId,
  });

  if (error) {
    const message = error.message || 'Unable to load question bank';

    if (message.includes('Authentication required')) {
      throw new QuestionBankAuthenticationError(message);
    }

    if (message.includes('Question bank access denied')) {
      throw new QuestionBankAccessError(message);
    }

    throw new Error(message);
  }

  if (!Array.isArray(data)) {
    throw new Error('Invalid question bank dashboard response');
  }

  return buildPrecomputedQuestionBankOutline(data as PrecomputedDashboardRow[]);
}

export async function getLiveQuestionBankCategories(bankId: number): Promise<CategorySummary[]> {
  const outline = await getLiveQuestionBankOutline(bankId);
  return outline.map(({ id, name, total, attempted }) => ({ id, name, total, attempted }));
}

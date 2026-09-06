import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getBankQuestionRows, type BankQuestionRow } from '@/lib/bank-question-rows';
import type { CategoryWithTopics, DifficultyCounts } from '@/types/question-bank';
import type { CategorySummary } from '@/types/exam';

const createEmptyCounts = (): DifficultyCounts => ({ '1': 0, '2': 0, '3': 0 });

type UserStateCounts = {
  attempted: DifficultyCounts;
  incorrect: DifficultyCounts;
  flagged: DifficultyCounts;
  suspended: DifficultyCounts;
};

type OutlineSummary = {
  name: string;
  totalByDiff: DifficultyCounts;
  topics: Map<string, { totalByDiff: DifficultyCounts }>;
};

const emptyUserState = (): UserStateCounts => ({
  attempted: createEmptyCounts(),
  incorrect: createEmptyCounts(),
  flagged: createEmptyCounts(),
  suspended: createEmptyCounts(),
});

async function getUserQuestionStateMap() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const stateMap = new Map<string, UserStateCounts>();

  if (!user) return stateMap;

  const getOrCreate = (category: string, topic: string | null) => {
    const key = topic ? `${category}|||${topic}` : category;
    const existing = stateMap.get(key);
    if (existing) return existing;
    const created = emptyUserState();
    stateMap.set(key, created);
    return created;
  };

  const { data: rows, error } = await supabase.rpc('get_user_question_state');
  if (error) throw new Error(error.message);

  for (const row of rows || []) {
    const category = row.category as string | null;
    if (!category) continue;
    const topic = (row.topic as string | null) || null;
    const difficulty = String(row.difficulty || '1');
    if (!(difficulty in createEmptyCounts())) continue;

    const apply = (state: UserStateCounts) => {
      if (row.is_answered) state.attempted[difficulty] += 1;
      if (row.is_incorrect) state.incorrect[difficulty] += 1;
      if (row.is_flagged) state.flagged[difficulty] += 1;
      if (row.is_suspended) state.suspended[difficulty] += 1;
    };

    apply(getOrCreate(category, topic));
    if (topic) apply(getOrCreate(category, null));
  }

  return stateMap;
}

function sumCounts(counts: DifficultyCounts): number {
  return counts['1'] + counts['2'] + counts['3'];
}

function buildQuestionBankOutline(
  rows: BankQuestionRow[],
  userStateMap: Map<string, UserStateCounts>,
): CategoryWithTopics[] {
  const categoryMap = new Map<string, OutlineSummary>();

  for (const row of rows) {
    const difficulty = String(row.difficulty || '1');
    if (!(difficulty in createEmptyCounts())) continue;

    let summary = categoryMap.get(row.category);
    if (!summary) {
      summary = { name: row.category, totalByDiff: createEmptyCounts(), topics: new Map() };
      categoryMap.set(row.category, summary);
    }

    summary.totalByDiff[difficulty] += Number(row.total_questions) || 0;

    if (row.topic) {
      let topicSummary = summary.topics.get(row.topic);
      if (!topicSummary) {
        topicSummary = { totalByDiff: createEmptyCounts() };
        summary.topics.set(row.topic, topicSummary);
      }
      topicSummary.totalByDiff[difficulty] += Number(row.total_questions) || 0;
    }
  }

  return Array.from(categoryMap.entries())
    .map(([category, summary]) => {
      const categoryState = userStateMap.get(category) || emptyUserState();
      const categoryTotal = sumCounts(summary.totalByDiff);
      const categoryAnswered = sumCounts(categoryState.attempted);
      const categorySuspended = sumCounts(categoryState.suspended);

      const topics = Array.from(summary.topics.entries())
        .map(([topic, topicSummary]) => {
          const topicState = userStateMap.get(`${category}|||${topic}`) || emptyUserState();
          const total = sumCounts(topicSummary.totalByDiff);
          const answered = sumCounts(topicState.attempted);
          const suspended = sumCounts(topicState.suspended);

          return {
            id: topic,
            name: topic,
            total,
            attempted: answered,
            newCount: Math.max(total - answered - suspended, 0),
            incorrectCount: sumCounts(topicState.incorrect),
            flaggedCount: sumCounts(topicState.flagged),
            suspendedCount: suspended,
            totalByDiff: topicSummary.totalByDiff,
            attemptedByDiff: topicState.attempted,
            incorrectByDiff: topicState.incorrect,
            flaggedByDiff: topicState.flagged,
            suspendedByDiff: topicState.suspended,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      return {
        id: category,
        name: summary.name,
        total: categoryTotal,
        attempted: categoryAnswered,
        newCount: Math.max(categoryTotal - categoryAnswered - categorySuspended, 0),
        incorrectCount: sumCounts(categoryState.incorrect),
        flaggedCount: sumCounts(categoryState.flagged),
        suspendedCount: categorySuspended,
        totalByDiff: summary.totalByDiff,
        attemptedByDiff: categoryState.attempted,
        incorrectByDiff: categoryState.incorrect,
        flaggedByDiff: categoryState.flagged,
        suspendedByDiff: categoryState.suspended,
        topics,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getLiveQuestionBankOutline(bankId: number): Promise<CategoryWithTopics[]> {
  const [rows, userStateMap] = await Promise.all([
    getBankQuestionRows(bankId),
    getUserQuestionStateMap(),
  ]);

  return buildQuestionBankOutline(rows, userStateMap);
}

export async function getLiveQuestionBankCategories(bankId: number): Promise<CategorySummary[]> {
  const outline = await getLiveQuestionBankOutline(bankId);
  return outline.map(({ id, name, total, attempted }) => ({ id, name, total, attempted }));
}

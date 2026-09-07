import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getBankQuestionRows, type BankQuestionRow } from '@/lib/bank-question-rows';
import type { CategoryWithTopics, DifficultyCounts } from '@/types/question-bank';
import type { CategorySummary } from '@/types/exam';

const createEmptyCounts = (): DifficultyCounts => ({ '1': 0, '2': 0, '3': 0 });
const QUESTION_METADATA_BATCH_SIZE = 400;

type UserStateCounts = {
  attempted: DifficultyCounts;
  incorrect: DifficultyCounts;
  flagged: DifficultyCounts;
  suspended: DifficultyCounts;
  newQuestions: DifficultyCounts;
};

type OutlineSummary = {
  name: string;
  totalByDiff: DifficultyCounts;
  topics: Map<string, { totalByDiff: DifficultyCounts }>;
};

type QuestionMeta = { id: number; category: string; topic: string | null; difficulty: string };

type CanonicalStateRow = {
  question_id: number;
  answer_state: string | null;
  is_suspended: boolean;
  is_flagged: boolean;
  is_new: boolean;
};

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

const emptyUserState = (): UserStateCounts => ({
  attempted: createEmptyCounts(),
  incorrect: createEmptyCounts(),
  flagged: createEmptyCounts(),
  suspended: createEmptyCounts(),
  newQuestions: createEmptyCounts(),
});

const emptyPrecomputedCounts = (): PrecomputedCounts => ({
  total: createEmptyCounts(),
  attempted: createEmptyCounts(),
  incorrect: createEmptyCounts(),
  flagged: createEmptyCounts(),
  suspended: createEmptyCounts(),
  newQuestions: createEmptyCounts(),
});

async function requireQuestionBankAccess(bankId: number) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Authentication required');
  }

  const { data: canAccess, error } = await supabase.rpc('can_access_question_bank', {
    p_bank_id: bankId,
  });

  if (error || canAccess !== true) {
    throw new Error('Question bank access required');
  }

  return supabase;
}

async function getPrecomputedDashboardRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  bankId: number,
): Promise<PrecomputedDashboardRow[] | null> {
  const { data, error } = await supabase.rpc('get_question_bank_dashboard', {
    p_bank_id: bankId,
  });

  // Keep the previous path as a deployment/migration compatibility fallback.
  // Once migration 004 is installed, this fast path is the normal path.
  if (error || !Array.isArray(data)) {
    if (error) console.warn('Precomputed question-bank dashboard unavailable:', error.message);
    return null;
  }

  return data as PrecomputedDashboardRow[];
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

async function fetchQuestionMetadata(
  supabase: Awaited<ReturnType<typeof createClient>>,
  questionIds: number[],
): Promise<QuestionMeta[]> {
  const rows: QuestionMeta[] = [];

  // Compatibility fallback only. The normal dashboard path returns a tiny
  // precomputed payload and never sends thousands of ids through PostgREST.
  for (let offset = 0; offset < questionIds.length; offset += QUESTION_METADATA_BATCH_SIZE) {
    const batch = questionIds.slice(offset, offset + QUESTION_METADATA_BATCH_SIZE);
    const { data, error } = await supabase
      .from('questions')
      .select('id, category, topic, difficulty')
      .in('id', batch);

    if (error) throw new Error(error.message);
    rows.push(...((data || []) as QuestionMeta[]));
  }

  return rows;
}

async function getUserQuestionStateMap(bankId: number) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  const { data: stateRows, error: stateError } = await supabase.rpc('get_user_question_states', {
    p_bank_id: bankId,
  });
  if (stateError) throw new Error(stateError.message);

  const states = (stateRows || []) as CanonicalStateRow[];
  const questionIds = states.map((row) => Number(row.question_id));
  if (questionIds.length === 0) return stateMap;

  const questionRows = await fetchQuestionMetadata(supabase, questionIds);
  const metadata = new Map<number, QuestionMeta>(
    questionRows.map((question) => [Number(question.id), question]),
  );

  for (const row of states) {
    const question = metadata.get(Number(row.question_id));
    if (!question?.category) continue;
    const difficulty = String(question.difficulty || '1');
    if (!(difficulty in createEmptyCounts())) continue;

    const apply = (state: UserStateCounts) => {
      if (row.answer_state !== null) state.attempted[difficulty] += 1;
      if (row.answer_state === 'incorrect') state.incorrect[difficulty] += 1;
      if (row.is_flagged) state.flagged[difficulty] += 1;
      if (row.is_suspended) state.suspended[difficulty] += 1;
      if (row.is_new) state.newQuestions[difficulty] += 1;
    };

    apply(getOrCreate(question.category, question.topic));
    if (question.topic) apply(getOrCreate(question.category, null));
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
            newCount: sumCounts(topicState.newQuestions),
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
        newCount: sumCounts(categoryState.newQuestions),
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
  const supabase = await requireQuestionBankAccess(bankId);

  const precomputedRows = await getPrecomputedDashboardRows(supabase, bankId);
  if (precomputedRows && precomputedRows.length > 0) {
    return buildPrecomputedQuestionBankOutline(precomputedRows);
  }

  // Compatibility fallback for environments where migration 004 is not installed yet.
  const [rows, userStateMap] = await Promise.all([
    getBankQuestionRows(bankId),
    getUserQuestionStateMap(bankId),
  ]);
  return buildQuestionBankOutline(rows, userStateMap);
}

export async function getLiveQuestionBankCategories(bankId: number): Promise<CategorySummary[]> {
  const outline = await getLiveQuestionBankOutline(bankId);
  return outline.map(({ id, name, total, attempted }) => ({ id, name, total, attempted }));
}

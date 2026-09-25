import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  readRevisionQuestionContent,
  readRevisionQuestionFeedback,
  type RevisionR2Feedback,
  type RevisionR2Question,
} from '@/lib/exam-r2-content';
import { readStaticBankSelectionIndex } from '@/lib/ui-static-r2';

export type RevisionStatusFilter = 'all' | 'incorrect' | 'correct' | 'flagged';
export type RevisionSort = 'date' | 'alpha';
export type RevisionDifficultyFilter = 'all' | '1' | '2' | '3';

export interface RevisionFilters {
  status: RevisionStatusFilter;
  category: string | null;
  difficulty: RevisionDifficultyFilter;
  q: string;
  sort: RevisionSort;
  page: number;
}

export interface RevisionCategoryFilter {
  name: string;
  count: number;
}

export interface RevisionListItem {
  questionId: number;
  category: string;
  topic: string | null;
  difficulty: string;
  selectedOptionId: number;
  isCorrect: boolean;
  isFlagged: boolean;
  answeredAt: string;
  contentReleaseId: string | null;
  title: string;
  preview: string;
}

export interface RevisionIndex {
  totals: {
    answered: number;
    correct: number;
    incorrect: number;
    flagged: number;
  };
  categories: RevisionCategoryFilter[];
  items: RevisionListItem[];
  totalFiltered: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface RevisionQuestionDetail {
  questionId: number;
  category: string;
  topic: string | null;
  difficulty: string;
  selectedOptionId: number;
  isCorrect: boolean;
  isFlagged: boolean;
  answeredAt: string;
  contentReleaseId: string | null;
  question: RevisionR2Question | null;
  feedback: RevisionR2Feedback | null;
  previousQuestionId: number | null;
  nextQuestionId: number | null;
  position: number;
  total: number;
}

type SessionRow = {
  id: string;
  is_completed: boolean;
  session_type: string;
  content_release_id: string | null;
};

type AnswerRow = {
  id: number;
  test_session_id: string;
  question_id: number;
  selected_option_id: number | null;
  is_correct: boolean;
  answered_at: string;
};

type RevisionBaseRow = {
  questionId: number;
  category: string;
  topic: string | null;
  difficulty: string;
  selectedOptionId: number;
  isCorrect: boolean;
  isFlagged: boolean;
  answeredAt: string;
  contentReleaseId: string | null;
};

const PAGE_SIZE = 12;
const SESSION_PAGE_SIZE = 500;
const IN_CHUNK_SIZE = 150;

function plainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function clampPage(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

export function normalizeRevisionFilters(
  input: Partial<Record<'status' | 'category' | 'difficulty' | 'q' | 'sort' | 'page', string | string[] | undefined>>,
): RevisionFilters {
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const statusRaw = first(input.status);
  const difficultyRaw = first(input.difficulty);
  const sortRaw = first(input.sort);
  const pageRaw = Number(first(input.page) || 1);

  return {
    status: statusRaw === 'incorrect' || statusRaw === 'correct' || statusRaw === 'flagged' ? statusRaw : 'all',
    category: first(input.category)?.trim() || null,
    difficulty: difficultyRaw === '1' || difficultyRaw === '2' || difficultyRaw === '3' ? difficultyRaw : 'all',
    q: (first(input.q) || '').trim().slice(0, 120),
    sort: sortRaw === 'alpha' ? 'alpha' : 'date',
    page: clampPage(pageRaw),
  };
}

async function fetchFinalizedSessions(bankId: number): Promise<SessionRow[]> {
  const supabase = await createClient();
  const rows: SessionRow[] = [];

  for (let start = 0; start < 5000; start += SESSION_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('test_sessions')
      .select('id,is_completed,session_type,content_release_id')
      .eq('question_bank_id', bankId)
      .or('is_completed.eq.true,session_type.in.(standard,tutor)')
      .order('started_at', { ascending: false })
      .range(start, start + SESSION_PAGE_SIZE - 1);

    if (error) throw new Error(error.message || 'Unable to load revision sessions');
    const page = (data || []) as unknown as SessionRow[];
    rows.push(...page);
    if (page.length < SESSION_PAGE_SIZE) break;
  }

  return rows;
}

async function fetchAnswers(sessionIds: string[]): Promise<AnswerRow[]> {
  if (sessionIds.length === 0) return [];
  const supabase = await createClient();
  const rows: AnswerRow[] = [];

  for (let index = 0; index < sessionIds.length; index += IN_CHUNK_SIZE) {
    const ids = sessionIds.slice(index, index + IN_CHUNK_SIZE);
    const { data, error } = await supabase
      .from('user_answers')
      .select('id,test_session_id,question_id,selected_option_id,is_correct,answered_at')
      .in('test_session_id', ids)
      .not('selected_option_id', 'is', null)
      .order('answered_at', { ascending: false });

    if (error) throw new Error(error.message || 'Unable to load revision answers');
    rows.push(...((data || []) as unknown as AnswerRow[]));
  }

  return rows;
}

async function fetchFlaggedQuestionIds(): Promise<Set<number>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('user_question_flags')
    .select('question_id');

  if (error) throw new Error(error.message || 'Unable to load question flags');
  return new Set(
    ((data || []) as unknown as Array<{ question_id: number }>)
      .map((row) => Number(row.question_id))
      .filter((value) => Number.isSafeInteger(value) && value > 0),
  );
}

async function getRevisionBaseRows(bankId: number): Promise<RevisionBaseRow[]> {
  const [sessions, selectionIndex, flaggedIds] = await Promise.all([
    fetchFinalizedSessions(bankId),
    readStaticBankSelectionIndex(bankId),
    fetchFlaggedQuestionIds(),
  ]);

  if (sessions.length === 0) return [];

  const sessionById = new Map(sessions.map((row) => [row.id, row]));
  const bankMetadata = new Map(
    (selectionIndex?.questions || []).map((question) => [question.id, question]),
  );
  const answers = await fetchAnswers(sessions.map((row) => row.id));

  const latestByQuestion = new Map<number, AnswerRow>();
  for (const answer of answers) {
    if (!Number.isSafeInteger(answer.question_id) || answer.question_id <= 0) continue;
    if (!bankMetadata.has(answer.question_id)) continue;
    if (!latestByQuestion.has(answer.question_id)) latestByQuestion.set(answer.question_id, answer);
  }

  return [...latestByQuestion.values()].map((answer) => {
    const meta = bankMetadata.get(answer.question_id);
    const session = sessionById.get(answer.test_session_id);
    return {
      questionId: answer.question_id,
      category: meta?.category || 'Uncategorized',
      topic: meta?.topic || null,
      difficulty: meta?.difficulty || '1',
      selectedOptionId: Number(answer.selected_option_id),
      isCorrect: answer.is_correct === true,
      isFlagged: flaggedIds.has(answer.question_id),
      answeredAt: answer.answered_at,
      contentReleaseId: session?.content_release_id || selectionIndex?.release_id || null,
    };
  });
}

function applyFilters(rows: RevisionBaseRow[], filters: RevisionFilters): RevisionBaseRow[] {
  const query = filters.q.toLocaleLowerCase();

  const filtered = rows.filter((row) => {
    if (filters.status === 'correct' && !row.isCorrect) return false;
    if (filters.status === 'incorrect' && row.isCorrect) return false;
    if (filters.status === 'flagged' && !row.isFlagged) return false;
    if (filters.category && row.category !== filters.category) return false;
    if (filters.difficulty !== 'all' && row.difficulty !== filters.difficulty) return false;
    if (query) {
      const haystack = `${row.topic || ''} ${row.category} ${row.questionId}`.toLocaleLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (filters.sort === 'alpha') {
      const first = (a.topic || a.category).localeCompare(b.topic || b.category);
      return first || a.questionId - b.questionId;
    }
    const time = Date.parse(b.answeredAt) - Date.parse(a.answeredAt);
    return time || b.questionId - a.questionId;
  });

  return filtered;
}

async function hydrateListItems(rows: RevisionBaseRow[]): Promise<RevisionListItem[]> {
  return Promise.all(rows.map(async (row) => {
    const content = await readRevisionQuestionContent(row.contentReleaseId, row.questionId);
    const preview = content?.text_html ? plainText(content.text_html) : '';
    return {
      ...row,
      title: content?.topic || row.topic || `Question ${row.questionId}`,
      preview: preview.length > 150 ? `${preview.slice(0, 147)}…` : preview,
    };
  }));
}

export async function getRevisionIndex(bankId: number, filters: RevisionFilters): Promise<RevisionIndex> {
  const allRows = await getRevisionBaseRows(bankId);
  const filtered = applyFilters(allRows, filters);
  const totalFiltered = filtered.length;
  const pageCount = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  const start = (page - 1) * PAGE_SIZE;
  const items = await hydrateListItems(filtered.slice(start, start + PAGE_SIZE));

  const categoryCounts = new Map<string, number>();
  for (const row of allRows) categoryCounts.set(row.category, (categoryCounts.get(row.category) || 0) + 1);

  return {
    totals: {
      answered: allRows.length,
      correct: allRows.filter((row) => row.isCorrect).length,
      incorrect: allRows.filter((row) => !row.isCorrect).length,
      flagged: allRows.filter((row) => row.isFlagged).length,
    },
    categories: [...categoryCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    items,
    totalFiltered,
    page,
    pageSize: PAGE_SIZE,
    pageCount,
  };
}

export async function getRevisionQuestion(
  bankId: number,
  questionId: number,
  filters: RevisionFilters,
): Promise<RevisionQuestionDetail | null> {
  const allRows = await getRevisionBaseRows(bankId);
  const filtered = applyFilters(allRows, filters);
  const position = filtered.findIndex((row) => row.questionId === questionId);
  if (position < 0) return null;

  const row = filtered[position];
  const [question, feedback] = await Promise.all([
    readRevisionQuestionContent(row.contentReleaseId, row.questionId),
    readRevisionQuestionFeedback(row.contentReleaseId, row.questionId),
  ]);

  return {
    ...row,
    question,
    feedback,
    previousQuestionId: position > 0 ? filtered[position - 1].questionId : null,
    nextQuestionId: position < filtered.length - 1 ? filtered[position + 1].questionId : null,
    position: position + 1,
    total: filtered.length,
  };
}

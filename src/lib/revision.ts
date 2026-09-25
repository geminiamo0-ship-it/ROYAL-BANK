import 'server-only';

import {
  readRevisionQuestionContent,
  readRevisionQuestionFeedback,
  type RevisionR2Feedback,
  type RevisionR2Question,
} from '@/lib/exam-r2-content';
import { createClient } from '@/lib/supabase/server';
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

type RevisionRpcRow = {
  question_id: number;
  answer_state: string;
  selected_option_id: number;
  is_flagged: boolean;
  answered_at: string;
  test_session_id: string;
  content_release_id: string | null;
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

async function getRevisionRpcRows(bankId: number): Promise<RevisionRpcRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_revision_question_index', {
    p_bank_id: bankId,
  });

  if (error) throw new Error(error.message || 'Unable to load revision questions');

  return ((data || []) as unknown as RevisionRpcRow[]).filter((row) => (
    Number.isSafeInteger(Number(row.question_id)) &&
    Number(row.question_id) > 0 &&
    Number.isSafeInteger(Number(row.selected_option_id)) &&
    Number(row.selected_option_id) > 0 &&
    (row.answer_state === 'correct' || row.answer_state === 'incorrect')
  ));
}

async function getRevisionBaseRows(bankId: number): Promise<RevisionBaseRow[]> {
  const [rpcRows, selectionIndex] = await Promise.all([
    getRevisionRpcRows(bankId),
    readStaticBankSelectionIndex(bankId),
  ]);

  const metadata = new Map(
    (selectionIndex?.questions || []).map((question) => [question.id, question]),
  );

  return rpcRows.map((row) => {
    const questionId = Number(row.question_id);
    const meta = metadata.get(questionId);
    return {
      questionId,
      category: meta?.category || 'Uncategorized',
      topic: meta?.topic || null,
      difficulty: meta?.difficulty || '1',
      selectedOptionId: Number(row.selected_option_id),
      isCorrect: row.answer_state === 'correct',
      isFlagged: row.is_flagged === true,
      answeredAt: row.answered_at || '',
      contentReleaseId: row.content_release_id || selectionIndex?.release_id || null,
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
    const aTime = Date.parse(a.answeredAt);
    const bTime = Date.parse(b.answeredAt);
    const time = (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
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
  for (const row of allRows) {
    categoryCounts.set(row.category, (categoryCounts.get(row.category) || 0) + 1);
  }

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
  const [allRows, supabase] = await Promise.all([
    getRevisionBaseRows(bankId),
    createClient(),
  ]);
  const filtered = applyFilters(allRows, filters);
  const position = filtered.findIndex((row) => row.questionId === questionId);
  if (position < 0) return null;

  const { data, error } = await supabase.rpc('get_revision_question_detail', {
    p_bank_id: bankId,
    p_question_id: questionId,
  });
  if (error) throw new Error(error.message || 'Unable to load revision question');

  const detailRow = ((data || []) as unknown as RevisionRpcRow[])[0];
  if (!detailRow) return null;

  const row = filtered[position];
  const releaseId = detailRow.content_release_id || row.contentReleaseId;
  const [question, feedback] = await Promise.all([
    readRevisionQuestionContent(releaseId, questionId),
    readRevisionQuestionFeedback(releaseId, questionId),
  ]);

  return {
    ...row,
    selectedOptionId: Number(detailRow.selected_option_id),
    isCorrect: detailRow.answer_state === 'correct',
    isFlagged: detailRow.is_flagged === true,
    answeredAt: detailRow.answered_at || row.answeredAt,
    contentReleaseId: releaseId,
    question,
    feedback,
    previousQuestionId: position > 0 ? filtered[position - 1].questionId : null,
    nextQuestionId: position < filtered.length - 1 ? filtered[position + 1].questionId : null,
    position: position + 1,
    total: filtered.length,
  };
}

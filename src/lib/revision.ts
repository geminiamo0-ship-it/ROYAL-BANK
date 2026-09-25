import 'server-only';

import {
  readRevisionQuestionContent,
  readRevisionQuestionFeedback,
  type RevisionR2Feedback,
  type RevisionR2Question,
} from '@/lib/exam-r2-content';
import { requireSupabaseServerConfig } from '@/lib/supabase/env';
import { createClient } from '@/lib/supabase/server';
import { readStaticBankSelectionIndex } from '@/lib/ui-static-r2';

export type RevisionStatusFilter = 'all' | 'incorrect' | 'correct' | 'flagged';
export type RevisionDifficultyFilter = 'all' | '1' | '2' | '3';

export interface RevisionFilters {
  status: RevisionStatusFilter;
  category: string | null;
  topic: string | null;
  difficulty: RevisionDifficultyFilter;
  q: string;
  page: number;
}

export interface RevisionTopicFilter {
  name: string;
  count: number;
}

export interface RevisionCategoryFilter {
  name: string;
  count: number;
  topics: RevisionTopicFilter[];
}

export interface RevisionListItem {
  questionId: number;
  category: string;
  topic: string | null;
  difficulty: string;
  selectedOptionId: number | null;
  isCorrect: boolean;
  isFlagged: boolean;
  answeredAt: string;
  contentReleaseId: string | null;
  testSessionId: string | null;
  source: 'legacy' | 'edge';
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
  selectedOptionId: number | null;
  isCorrect: boolean;
  isFlagged: boolean;
  answeredAt: string;
  contentReleaseId: string | null;
  testSessionId: string | null;
  source: 'legacy' | 'edge';
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
  selected_option_id: number | null;
  is_flagged: boolean;
  answered_at: string;
  test_session_id: string | null;
  content_release_id: string | null;
  source: 'legacy' | 'edge';
  category: string | null;
  topic: string | null;
  difficulty: string | null;
};

type RevisionBaseRow = {
  questionId: number;
  category: string;
  topic: string | null;
  difficulty: string;
  selectedOptionId: number | null;
  isCorrect: boolean;
  isFlagged: boolean;
  answeredAt: string;
  contentReleaseId: string | null;
  testSessionId: string | null;
  source: 'legacy' | 'edge';
};

const PAGE_SIZE = 10;

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
  input: Partial<Record<'status' | 'category' | 'topic' | 'difficulty' | 'q' | 'page', string | string[] | undefined>>,
): RevisionFilters {
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const statusRaw = first(input.status);
  const difficultyRaw = first(input.difficulty);
  const pageRaw = Number(first(input.page) || 1);

  return {
    status: statusRaw === 'incorrect' || statusRaw === 'correct' || statusRaw === 'flagged' ? statusRaw : 'all',
    category: first(input.category)?.trim() || null,
    topic: first(input.topic)?.trim() || null,
    difficulty: difficultyRaw === '1' || difficultyRaw === '2' || difficultyRaw === '3' ? difficultyRaw : 'all',
    q: (first(input.q) || '').trim().slice(0, 120),
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
    (row.answer_state === 'correct' || row.answer_state === 'incorrect')
  ));
}

async function getRevisionBaseRows(bankId: number): Promise<RevisionBaseRow[]> {
  const [rpcRows, selectionIndex] = await Promise.all([
    getRevisionRpcRows(bankId),
    readStaticBankSelectionIndex(bankId),
  ]);

  return rpcRows.map((row) => ({
    questionId: Number(row.question_id),
    category: row.category?.trim() || 'Uncategorized',
    topic: row.topic?.trim() || null,
    difficulty: row.difficulty?.trim() || '1',
    selectedOptionId:
      row.selected_option_id == null || !Number.isSafeInteger(Number(row.selected_option_id))
        ? null
        : Number(row.selected_option_id),
    isCorrect: row.answer_state === 'correct',
    isFlagged: row.is_flagged === true,
    answeredAt: row.answered_at || '',
    contentReleaseId: row.content_release_id || selectionIndex?.release_id || null,
    testSessionId: row.test_session_id || null,
    source: row.source === 'edge' ? 'edge' : 'legacy',
  }));
}

function applyFilters(rows: RevisionBaseRow[], filters: RevisionFilters): RevisionBaseRow[] {
  const query = filters.q.toLocaleLowerCase();

  const filtered = rows.filter((row) => {
    if (filters.status === 'correct' && !row.isCorrect) return false;
    if (filters.status === 'incorrect' && row.isCorrect) return false;
    if (filters.status === 'flagged' && !row.isFlagged) return false;
    if (filters.category && row.category !== filters.category) return false;
    if (filters.topic && row.topic !== filters.topic) return false;
    if (filters.difficulty !== 'all' && row.difficulty !== filters.difficulty) return false;

    if (query) {
      const haystack = `${row.topic || ''} ${row.category} ${row.questionId}`.toLocaleLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
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
      title: row.topic || content?.topic || `Question ${row.questionId}`,
      preview: preview.length > 150 ? `${preview.slice(0, 147)}…` : preview,
    };
  }));
}

type EdgeReviewFeedback = {
  selected_option_id?: number | null;
  is_correct?: boolean | null;
};

async function getEdgeHistoricalAnswer(
  sessionId: string,
  questionId: number,
): Promise<{ selectedOptionId: number; isCorrect: boolean | null } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (error || !accessToken) return null;

  const { url: supabaseUrl } = requireSupabaseServerConfig();
  const workerBase = supabaseUrl.includes('dcttiqdrsvkufzjahjzw')
    ? 'https://royal-bank-v2-exam.geminiamo0.workers.dev'
    : 'https://royal-bank-exam-production.geminiamo0.workers.dev';

  try {
    const response = await fetch(`${workerBase}/exam`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        action: 'reviewFeedback',
        args: {
          p_session_id: sessionId,
          p_question_id: questionId,
        },
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;
    const payload = await response.json() as EdgeReviewFeedback;
    const selectedOptionId = Number(payload.selected_option_id);
    if (!Number.isSafeInteger(selectedOptionId) || selectedOptionId <= 0) return null;

    return {
      selectedOptionId,
      isCorrect: typeof payload.is_correct === 'boolean' ? payload.is_correct : null,
    };
  } catch {
    return null;
  }
}

function buildCategoryFilters(rows: RevisionBaseRow[]): RevisionCategoryFilter[] {
  const categories = new Map<string, { count: number; topics: Map<string, number> }>();

  for (const row of rows) {
    const existing = categories.get(row.category) ?? { count: 0, topics: new Map<string, number>() };
    existing.count += 1;
    if (row.topic) {
      existing.topics.set(row.topic, (existing.topics.get(row.topic) || 0) + 1);
    }
    categories.set(row.category, existing);
  }

  return [...categories.entries()]
    .map(([name, value]) => ({
      name,
      count: value.count,
      topics: [...value.topics.entries()]
        .map(([topicName, count]) => ({ name: topicName, count }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getRevisionIndex(bankId: number, filters: RevisionFilters): Promise<RevisionIndex> {
  const allRows = await getRevisionBaseRows(bankId);
  const filtered = applyFilters(allRows, filters);
  const totalFiltered = filtered.length;
  const pageCount = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  const start = (page - 1) * PAGE_SIZE;
  const items = await hydrateListItems(filtered.slice(start, start + PAGE_SIZE));

  return {
    totals: {
      answered: allRows.length,
      correct: allRows.filter((row) => row.isCorrect).length,
      incorrect: allRows.filter((row) => !row.isCorrect).length,
      flagged: allRows.filter((row) => row.isFlagged).length,
    },
    categories: buildCategoryFilters(allRows),
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
  let selectedOptionId =
    detailRow.selected_option_id == null || !Number.isSafeInteger(Number(detailRow.selected_option_id))
      ? null
      : Number(detailRow.selected_option_id);
  let isCorrect = detailRow.answer_state === 'correct';

  if (selectedOptionId == null && detailRow.source === 'edge' && detailRow.test_session_id) {
    const historical = await getEdgeHistoricalAnswer(detailRow.test_session_id, questionId);
    if (historical) {
      selectedOptionId = historical.selectedOptionId;
      if (historical.isCorrect != null) isCorrect = historical.isCorrect;
    }
  }

  const [question, feedback] = await Promise.all([
    readRevisionQuestionContent(releaseId, questionId),
    readRevisionQuestionFeedback(releaseId, questionId),
  ]);

  return {
    ...row,
    category: detailRow.category?.trim() || row.category,
    topic: detailRow.topic?.trim() || row.topic,
    difficulty: detailRow.difficulty?.trim() || row.difficulty,
    selectedOptionId,
    isCorrect,
    isFlagged: detailRow.is_flagged === true,
    answeredAt: detailRow.answered_at || row.answeredAt,
    contentReleaseId: releaseId,
    testSessionId: detailRow.test_session_id || row.testSessionId,
    source: detailRow.source === 'edge' ? 'edge' : 'legacy',
    question,
    feedback,
    previousQuestionId: position > 0 ? filtered[position - 1].questionId : null,
    nextQuestionId: position < filtered.length - 1 ? filtered[position + 1].questionId : null,
    position: position + 1,
    total: filtered.length,
  };
}

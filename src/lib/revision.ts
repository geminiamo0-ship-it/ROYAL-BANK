import 'server-only';

import { headers } from 'next/headers';
import { getLiveBankSessions, type BankSessionSummary } from '@/lib/bank-performance';
import {
  readRevisionQuestionContent,
  readRevisionQuestionFeedback,
  type RevisionR2Feedback,
  type RevisionR2Question,
} from '@/lib/exam-r2-content';
import { buildGatewayProof, gatewayHeaders } from '@/lib/exam-gateway-server';
import { createClient } from '@/lib/supabase/server';
import { requireSupabaseServerConfig } from '@/lib/supabase/env';
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
  selectedOptionId: number | null;
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

type RevisionStateRow = {
  question_id: number;
  answer_state: string | null;
  is_suspended: boolean;
  is_flagged: boolean;
  is_new: boolean;
};

type SessionQuestionRow = {
  test_session_id: string;
  question_id: number;
};

type RevisionBaseRow = {
  questionId: number;
  category: string;
  topic: string | null;
  difficulty: string;
  isCorrect: boolean;
  isFlagged: boolean;
  answeredAt: string;
  contentReleaseId: string | null;
};

type ProtectedFeedback = {
  question_id?: number;
  selected_option_id?: number | null;
  is_correct?: boolean | null;
  content_release_id?: string | null;
};

type GatewayContext = {
  supabaseUrl: string;
  publishableKey: string;
  accessToken: string;
  proof: ReturnType<typeof buildGatewayProof>;
};

const PAGE_SIZE = 12;
const SESSION_LIMIT = 100;
const SESSION_CHUNK_SIZE = 40;

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

function sessionDate(session: BankSessionSummary): string {
  return session.completed_at || session.started_at || '';
}

function isFinalizedSession(session: BankSessionSummary): boolean {
  return session.is_completed || session.session_type === 'standard' || session.session_type === 'tutor';
}

function sessionTimestamp(session: BankSessionSummary): number {
  const value = Date.parse(sessionDate(session));
  return Number.isFinite(value) ? value : 0;
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

async function getRevisionStates(bankId: number): Promise<RevisionStateRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_user_question_states', { p_bank_id: bankId });
  if (error) throw new Error(error.message || 'Unable to load revision state');

  return ((data || []) as unknown as RevisionStateRow[]).filter(
    (row) => row.answer_state === 'correct' || row.answer_state === 'incorrect',
  );
}

async function getQuestionSessionDates(
  sessions: BankSessionSummary[],
): Promise<Map<number, string>> {
  const finalized = sessions.filter(isFinalizedSession);
  if (finalized.length === 0) return new Map();

  const sessionById = new Map(finalized.map((session) => [session.id, session]));
  const supabase = await createClient();
  const latestByQuestion = new Map<number, { timestamp: number; date: string }>();

  for (let index = 0; index < finalized.length; index += SESSION_CHUNK_SIZE) {
    const ids = finalized.slice(index, index + SESSION_CHUNK_SIZE).map((session) => session.id);
    const { data, error } = await supabase
      .from('test_session_questions')
      .select('test_session_id,question_id')
      .in('test_session_id', ids);

    if (error) throw new Error(error.message || 'Unable to load revision session mapping');

    for (const row of (data || []) as unknown as SessionQuestionRow[]) {
      const session = sessionById.get(String(row.test_session_id));
      const questionId = Number(row.question_id);
      if (!session || !Number.isSafeInteger(questionId) || questionId <= 0) continue;

      const timestamp = sessionTimestamp(session);
      const current = latestByQuestion.get(questionId);
      if (!current || timestamp > current.timestamp) {
        latestByQuestion.set(questionId, { timestamp, date: sessionDate(session) });
      }
    }
  }

  return new Map([...latestByQuestion.entries()].map(([questionId, value]) => [questionId, value.date]));
}

async function getRevisionBaseRows(bankId: number): Promise<RevisionBaseRow[]> {
  const [states, selectionIndex, sessions] = await Promise.all([
    getRevisionStates(bankId),
    readStaticBankSelectionIndex(bankId),
    getLiveBankSessions(bankId, SESSION_LIMIT),
  ]);

  const metadata = new Map(
    (selectionIndex?.questions || []).map((question) => [question.id, question]),
  );
  const dates = await getQuestionSessionDates(sessions);

  return states.map((state) => {
    const questionId = Number(state.question_id);
    const meta = metadata.get(questionId);
    return {
      questionId,
      category: meta?.category || 'Uncategorized',
      topic: meta?.topic || null,
      difficulty: meta?.difficulty || '1',
      isCorrect: state.answer_state === 'correct',
      isFlagged: state.is_flagged === true,
      answeredAt: dates.get(questionId) || '',
      contentReleaseId: selectionIndex?.release_id || null,
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
    if (Number.isFinite(time) && time !== 0) return time;
    return b.questionId - a.questionId;
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

async function createGatewayContext(): Promise<GatewayContext> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (error || !accessToken) throw new Error('Authentication required');

  const { url: supabaseUrl, publishableKey } = requireSupabaseServerConfig();
  const gatewayKeyId = process.env.ROYAL_GATEWAY_KEY_ID || '';
  const gatewayKey = process.env.ROYAL_GATEWAY_KEY || '';
  const riskHmacSecret = process.env.ROYAL_RISK_HMAC_SECRET || '';
  if (!gatewayKeyId || !gatewayKey || !riskHmacSecret) {
    throw new Error('Revision gateway is not configured');
  }

  const incoming = await headers();
  const proofRequest = new Request('https://royalbank.local/revision', {
    headers: new Headers(incoming),
  });
  const proof = buildGatewayProof({
    request: proofRequest,
    gatewayKeyId,
    gatewayKey,
    riskHmacSecret,
  });

  return { supabaseUrl, publishableKey, accessToken, proof };
}

async function callProtectedFeedback(
  context: GatewayContext,
  rpcName: 'get_completed_exam_review_feedback_ref_v2' | 'get_exam_question_feedback_ref_v2',
  sessionId: string,
  questionId: number,
): Promise<ProtectedFeedback | null> {
  try {
    const response = await fetch(`${context.supabaseUrl}/rest/v1/rpc/${rpcName}`, {
      method: 'POST',
      cache: 'no-store',
      headers: gatewayHeaders(
        context.publishableKey,
        context.accessToken,
        context.proof,
      ),
      body: JSON.stringify({
        p_session_id: sessionId,
        p_question_id: questionId,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;
    return await response.json() as ProtectedFeedback;
  } catch {
    return null;
  }
}

async function findReviewAnswer(
  bankId: number,
  questionId: number,
): Promise<{
  selectedOptionId: number | null;
  isCorrect: boolean | null;
  contentReleaseId: string | null;
  answeredAt: string;
} | null> {
  const sessions = (await getLiveBankSessions(bankId, SESSION_LIMIT))
    .filter(isFinalizedSession)
    .sort((a, b) => sessionTimestamp(b) - sessionTimestamp(a));

  if (sessions.length === 0) return null;

  const supabase = await createClient();
  const sessionIds = sessions.map((session) => session.id);
  const matchingSessionIds = new Set<string>();

  for (let index = 0; index < sessionIds.length; index += SESSION_CHUNK_SIZE) {
    const ids = sessionIds.slice(index, index + SESSION_CHUNK_SIZE);
    const { data, error } = await supabase
      .from('test_session_questions')
      .select('test_session_id,question_id')
      .eq('question_id', questionId)
      .in('test_session_id', ids);

    if (error) throw new Error(error.message || 'Unable to locate reviewed question');
    for (const row of (data || []) as unknown as SessionQuestionRow[]) {
      matchingSessionIds.add(String(row.test_session_id));
    }
  }

  if (matchingSessionIds.size === 0) return null;

  const context = await createGatewayContext();

  for (const session of sessions) {
    if (!matchingSessionIds.has(session.id)) continue;

    const rpcName = session.is_completed
      ? 'get_completed_exam_review_feedback_ref_v2'
      : 'get_exam_question_feedback_ref_v2';

    const feedback = await callProtectedFeedback(context, rpcName, session.id, questionId);
    if (!feedback || feedback.selected_option_id == null) continue;

    return {
      selectedOptionId: Number(feedback.selected_option_id),
      isCorrect: typeof feedback.is_correct === 'boolean' ? feedback.is_correct : null,
      contentReleaseId:
        typeof feedback.content_release_id === 'string'
          ? feedback.content_release_id
          : null,
      answeredAt: sessionDate(session),
    };
  }

  return null;
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
  const answer = await findReviewAnswer(bankId, questionId);
  if (!answer) return null;

  const releaseId = answer.contentReleaseId || row.contentReleaseId;
  const [question, feedback] = await Promise.all([
    readRevisionQuestionContent(releaseId, row.questionId),
    readRevisionQuestionFeedback(releaseId, row.questionId),
  ]);

  return {
    ...row,
    selectedOptionId: answer.selectedOptionId,
    isCorrect: answer.isCorrect ?? row.isCorrect,
    answeredAt: answer.answeredAt || row.answeredAt,
    contentReleaseId: releaseId,
    question,
    feedback,
    previousQuestionId: position > 0 ? filtered[position - 1].questionId : null,
    nextQuestionId: position < filtered.length - 1 ? filtered[position + 1].questionId : null,
    position: position + 1,
    total: filtered.length,
  };
}

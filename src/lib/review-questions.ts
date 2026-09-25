import 'server-only';

import { getLiveQuestionBankOutline } from '@/lib/question-bank';
import { createClient } from '@/lib/supabase/server';
import { readStaticBankSelectionIndex } from '@/lib/ui-static-r2';
import { resolveActiveExamContentRelease } from '@/lib/exam-r2-content';
import { readPrivateR2Json } from '@/lib/r2-private';

export type ReviewQuestionStatus = 'correct' | 'incorrect';

export interface ReviewQuestionRow {
  questionId: number;
  title: string;
  snippet: string;
  category: string;
  topic: string | null;
  difficulty: string;
  status: ReviewQuestionStatus;
  isFlagged: boolean;
  answeredAt: string | null;
  reviewHref: string | null;
}

export interface ReviewTopicFilter {
  name: string;
  count: number;
}

export interface ReviewCategoryFilter {
  name: string;
  count: number;
  topics: ReviewTopicFilter[];
}

export interface ReviewQuestionsDashboard {
  answered: number;
  correct: number;
  incorrect: number;
  flagged: number;
  rows: ReviewQuestionRow[];
  categories: ReviewCategoryFilter[];
  loadedRows: number;
}

type QuestionStateRow = {
  question_id: number;
  answer_state: string | null;
  is_flagged: boolean;
};

type AnswerRow = {
  question_id: number;
  test_session_id: string;
  answered_at: string | null;
};

type SessionRow = {
  id: string;
  session_type: string;
  is_completed: boolean;
};

type R2QuestionPreview = {
  id?: number;
  text_html?: string;
};

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

async function readQuestionPreview(
  prefix: string | null,
  questionId: number,
): Promise<string | null> {
  if (!prefix) return null;
  try {
    const raw = await readPrivateR2Json<R2QuestionPreview>(
      `${prefix}/questions/${questionId}.json`,
      { maxBytes: 512 * 1024 },
    );
    if (Number(raw?.id) !== questionId || typeof raw?.text_html !== 'string') return null;
    const text = stripHtml(raw.text_html);
    return text.length > 210 ? `${text.slice(0, 207).trimEnd()}…` : text;
  } catch {
    return null;
  }
}

export async function getReviewQuestionsDashboard(
  bankId: number,
): Promise<ReviewQuestionsDashboard> {
  const supabase = await createClient();

  const [outline, staticIndex, release, stateResult, answerResult, sessionResult] = await Promise.all([
    getLiveQuestionBankOutline(bankId),
    readStaticBankSelectionIndex(bankId),
    resolveActiveExamContentRelease(),
    supabase.rpc('get_user_question_states', { p_bank_id: bankId }),
    supabase
      .from('user_answers')
      .select('question_id,test_session_id,answered_at')
      .order('answered_at', { ascending: false })
      .limit(5000),
    supabase
      .from('test_sessions')
      .select('id,session_type,is_completed')
      .eq('question_bank_id', bankId)
      .order('started_at', { ascending: false })
      .limit(1500),
  ]);

  if (stateResult.error) throw new Error(stateResult.error.message || 'Unable to load review state');
  if (answerResult.error) throw new Error(answerResult.error.message || 'Unable to load answer history');
  if (sessionResult.error) throw new Error(sessionResult.error.message || 'Unable to load review sessions');

  const states = (Array.isArray(stateResult.data) ? stateResult.data : []) as QuestionStateRow[];
  const answeredStates = states.filter(
    (row) => row.answer_state === 'correct' || row.answer_state === 'incorrect',
  );
  const stateByQuestion = new Map(answeredStates.map((row) => [Number(row.question_id), row]));
  const bankQuestionIds = new Set(
    (staticIndex?.questions ?? []).map((question) => Number(question.id)),
  );
  const metaByQuestion = new Map(
    (staticIndex?.questions ?? []).map((question) => [Number(question.id), question]),
  );

  const sessions = (Array.isArray(sessionResult.data) ? sessionResult.data : []) as SessionRow[];
  const sessionById = new Map(sessions.map((session) => [String(session.id), session]));

  const latestFinalAnswer = new Map<number, AnswerRow>();
  for (const raw of (Array.isArray(answerResult.data) ? answerResult.data : []) as AnswerRow[]) {
    const questionId = Number(raw.question_id);
    if (!stateByQuestion.has(questionId)) continue;
    if (bankQuestionIds.size > 0 && !bankQuestionIds.has(questionId)) continue;
    if (latestFinalAnswer.has(questionId)) continue;

    const session = sessionById.get(String(raw.test_session_id));
    if (!session) continue;
    if (!session.is_completed && session.session_type !== 'standard' && session.session_type !== 'tutor') {
      continue;
    }
    latestFinalAnswer.set(questionId, {
      question_id: questionId,
      test_session_id: String(raw.test_session_id),
      answered_at: raw.answered_at == null ? null : String(raw.answered_at),
    });
  }

  const orderedQuestionIds = [...answeredStates]
    .map((state) => Number(state.question_id))
    .sort((a, b) => {
      const aTime = latestFinalAnswer.get(a)?.answered_at
        ? Date.parse(latestFinalAnswer.get(a)!.answered_at!)
        : 0;
      const bTime = latestFinalAnswer.get(b)?.answered_at
        ? Date.parse(latestFinalAnswer.get(b)!.answered_at!)
        : 0;
      return bTime - aTime || b - a;
    })
    .slice(0, 140);

  const previews = new Map<number, string>();
  const prefix = release?.prefix ?? null;
  const previewEntries = await Promise.all(
    orderedQuestionIds.map(async (questionId) => [
      questionId,
      await readQuestionPreview(prefix, questionId),
    ] as const),
  );
  for (const [questionId, preview] of previewEntries) {
    if (preview) previews.set(questionId, preview);
  }

  const rows: ReviewQuestionRow[] = orderedQuestionIds.flatMap((questionId) => {
    const state = stateByQuestion.get(questionId);
    if (!state || (state.answer_state !== 'correct' && state.answer_state !== 'incorrect')) return [];

    const meta = metaByQuestion.get(questionId);
    const category = String(meta?.category || 'Uncategorised');
    const topic = meta?.topic == null ? null : String(meta.topic);
    const answer = latestFinalAnswer.get(questionId);
    const session = answer ? sessionById.get(answer.test_session_id) : null;
    const fallback = `Previously answered ${category} question`;

    return [{
      questionId,
      title: topic || category || `Question ${questionId}`,
      snippet: previews.get(questionId) || fallback,
      category,
      topic,
      difficulty: String(meta?.difficulty || '1'),
      status: state.answer_state,
      isFlagged: state.is_flagged === true,
      answeredAt: answer?.answered_at ?? null,
      reviewHref: session?.is_completed && answer
        ? `/exam/${encodeURIComponent(answer.test_session_id)}?review=1`
        : null,
    }];
  });

  const categories: ReviewCategoryFilter[] = outline
    .filter((category) => category.attempted > 0)
    .map((category) => ({
      name: category.name,
      count: category.attempted,
      topics: category.topics
        .filter((topic) => topic.attempted > 0)
        .map((topic) => ({ name: topic.name, count: topic.attempted })),
    }));

  const correct = answeredStates.filter((row) => row.answer_state === 'correct').length;
  const incorrect = answeredStates.filter((row) => row.answer_state === 'incorrect').length;
  const flagged = answeredStates.filter((row) => row.is_flagged).length;

  return {
    answered: answeredStates.length,
    correct,
    incorrect,
    flagged,
    rows,
    categories,
    loadedRows: rows.length,
  };
}

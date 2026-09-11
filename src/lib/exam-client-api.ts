import { callExamGateway } from '@/lib/exam-gateway-client';
import {
  normalizeExamBootstrap,
  normalizeExamQuestion,
  toClientExamAnswer,
  toClientExamFeedback,
  toClientTrainingFeedback,
  type RawExamBootstrap,
  type RawExamInlineFeedbackResult,
  type RawExamQuestionFeedback,
  type RawExamSubmitResult,
  type RawExamTrainingFeedback,
} from '@/lib/exam-wire';
import { decodeTopicFilter } from '@/lib/topic-filters';
import type {
  ExamBootstrap,
  ExamClientAnswer,
  ExamClientQuestion,
  ExamQuestionFeedback,
  ExamTrainingFeedback,
  StartExamInput,
} from '@/types/exam';

const inFlightExamCreates = new Map<string, Promise<ExamBootstrap>>();
const CREATE_REQUEST_STORAGE_KEY = 'royal.exam.pending-create-request-ids';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RawWindowAccessRenewal = {
  window_access_token?: string;
  window_access_expires_at?: number;
};

function loadCreateRequestIds(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(CREATE_REQUEST_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && UUID_PATTERN.test(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

function persistCreateRequestIds(values: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  try {
    if (Object.keys(values).length === 0) window.sessionStorage.removeItem(CREATE_REQUEST_STORAGE_KEY);
    else window.sessionStorage.setItem(CREATE_REQUEST_STORAGE_KEY, JSON.stringify(values));
  } catch {
    // Server-side idempotency remains authoritative if recovery storage is unavailable.
  }
}

function getOrCreateCreateRequestId(requestKey: string): string {
  const existing = loadCreateRequestIds();
  if (existing[requestKey]) return existing[requestKey];
  const requestId = crypto.randomUUID();
  persistCreateRequestIds({ ...existing, [requestKey]: requestId });
  return requestId;
}

function clearCreateRequestId(requestKey: string): void {
  const existing = loadCreateRequestIds();
  if (!existing[requestKey]) return;
  delete existing[requestKey];
  persistCreateRequestIds(existing);
}

export async function createExamSessionBootstrap(input: StartExamInput): Promise<ExamBootstrap> {
  const parsedTopics: Array<{ category: string; topic: string }> = [];
  const parsedCategories: string[] = [];

  for (const filterValue of [...input.categories, ...(input.topicFilters || [])]) {
    const topicFilter = decodeTopicFilter(filterValue);
    if (topicFilter) parsedTopics.push(topicFilter);
    else parsedCategories.push(filterValue);
  }

  const limit = Math.min(Math.max(input.limit || 70, 1), 70);
  const requestKey = JSON.stringify({
    bankId: input.bankId,
    sessionType: input.sessionType || 'standard',
    limit,
    difficulties: input.difficulties,
    categories: parsedCategories,
    topics: parsedTopics,
    questionSelection: input.questionSelection,
  });

  const existing = inFlightExamCreates.get(requestKey);
  if (existing) return existing;

  // Keep the UUID until a complete bootstrap is returned. If DB creation commits
  // but the response/R2 hydration is lost, an explicit user retry resolves the
  // same session instead of consuming another session slot.
  const requestId = getOrCreateCreateRequestId(requestKey);
  const args = {
    p_request_id: requestId,
    p_bank_id: input.bankId,
    p_session_type: input.sessionType || 'standard',
    p_limit: limit,
    p_difficulties: input.difficulties,
    p_categories: parsedCategories,
    p_topics: parsedTopics,
    p_question_selection: input.questionSelection,
  };

  const request = (async () => {
    const data = await callExamGateway<RawExamBootstrap, 'create'>('create', args);
    if (!data || typeof data !== 'object') {
      throw new Error('Exam bootstrap returned no result.');
    }
    const bootstrap = normalizeExamBootstrap(data);
    clearCreateRequestId(requestKey);
    return bootstrap;
  })();

  inFlightExamCreates.set(requestKey, request);

  try {
    return await request;
  } finally {
    if (inFlightExamCreates.get(requestKey) === request) {
      inFlightExamCreates.delete(requestKey);
    }
  }
}

export async function getExamSessionBootstrapDirect(sessionId: string): Promise<ExamBootstrap> {
  const data = await callExamGateway<RawExamBootstrap, 'bootstrap'>('bootstrap', {
    p_session_id: sessionId,
  });
  if (!data || typeof data !== 'object') throw new Error('Exam bootstrap returned no result.');
  return normalizeExamBootstrap(data);
}

export async function getCompletedExamReviewBootstrapDirect(sessionId: string): Promise<ExamBootstrap> {
  const data = await callExamGateway<RawExamBootstrap, 'reviewBootstrap'>('reviewBootstrap', {
    p_session_id: sessionId,
  });
  if (!data || typeof data !== 'object') throw new Error('Review bootstrap returned no result.');
  return normalizeExamBootstrap(data);
}

export async function renewExamWindowAccessDirect(sessionId: string): Promise<{
  windowAccessToken: string | null;
  windowAccessExpiresAt: number | null;
}> {
  const data = await callExamGateway<RawWindowAccessRenewal, 'renewWindowAccess'>('renewWindowAccess', {
    p_session_id: sessionId,
  });

  const rawExpiry = Number(data?.window_access_expires_at || 0);
  return {
    windowAccessToken:
      typeof data?.window_access_token === 'string' && data.window_access_token
        ? data.window_access_token
        : null,
    windowAccessExpiresAt:
      Number.isSafeInteger(rawExpiry) && rawExpiry > 0 ? rawExpiry : null,
  };
}

export async function getExamSessionWindowDirect(
  sessionId: string,
  start: number,
  count = 3,
  windowAccessToken?: string | null,
): Promise<ExamClientQuestion[]> {
  const data = await callExamGateway<ExamClientQuestion[], 'window'>(
    'window',
    {
      p_session_id: sessionId,
      p_start: Math.max(0, Math.floor(start)),
      p_count: Math.min(5, Math.max(1, Math.floor(count))),
    },
    { windowAccessToken },
  );

  if (!Array.isArray(data)) return [];
  return data.map(normalizeExamQuestion);
}

export async function getCompletedExamReviewWindowDirect(
  sessionId: string,
  start: number,
  count = 3,
  windowAccessToken?: string | null,
): Promise<ExamClientQuestion[]> {
  const data = await callExamGateway<ExamClientQuestion[], 'reviewWindow'>(
    'reviewWindow',
    {
      p_session_id: sessionId,
      p_start: Math.max(0, Math.floor(start)),
      p_count: Math.min(5, Math.max(1, Math.floor(count))),
    },
    { windowAccessToken },
  );

  if (!Array.isArray(data)) return [];
  return data.map(normalizeExamQuestion);
}

export async function getExamTrainingFeedbackDirect(
  sessionId: string,
  questionId: number,
): Promise<ExamTrainingFeedback> {
  const data = await callExamGateway<RawExamTrainingFeedback, 'trainingFeedback'>('trainingFeedback', {
    p_session_id: sessionId,
    p_question_id: questionId,
  });

  if (!data || typeof data !== 'object') throw new Error('Training feedback was not returned.');
  return toClientTrainingFeedback(data);
}

export async function submitExamAnswerWithFeedbackDirect(input: {
  requestId?: string;
  sessionId: string;
  questionId: number;
  selectedOptionId: number;
  timeSpentSeconds?: number;
}): Promise<{
  answer: ExamClientAnswer;
  feedback: ExamQuestionFeedback | null;
  feedbackPending: boolean;
}> {
  const raw = await callExamGateway<RawExamInlineFeedbackResult, 'submit'>('submit', {
    p_request_id: input.requestId || crypto.randomUUID(),
    p_session_id: input.sessionId,
    p_question_id: input.questionId,
    p_selected_option_id: input.selectedOptionId,
    p_time_spent_seconds: Math.max(0, Math.floor(input.timeSpentSeconds || 0)),
  });

  if (!raw || typeof raw !== 'object') throw new Error('Answer feedback was not returned.');
  if (!raw.answer) throw new Error('Answer payload is incomplete.');

  const feedback = raw.feedback ? toClientExamFeedback(raw.feedback) : null;
  return {
    answer: feedback
      ? {
          ...toClientExamAnswer(raw.answer),
          isCorrect: feedback.isCorrect,
          correctOptionId: feedback.correctOptionId,
        }
      : toClientExamAnswer(raw.answer),
    feedback,
    feedbackPending: Boolean(raw.feedback_pending || !feedback),
  };
}

export async function submitExamAnswerDirect(input: {
  requestId?: string;
  sessionId: string;
  questionId: number;
  selectedOptionId: number;
  timeSpentSeconds?: number;
}): Promise<ExamClientAnswer> {
  const data = await callExamGateway<RawExamSubmitResult, 'submitRaw'>('submitRaw', {
    p_request_id: input.requestId || crypto.randomUUID(),
    p_session_id: input.sessionId,
    p_question_id: input.questionId,
    p_selected_option_id: input.selectedOptionId,
    p_time_spent_seconds: Math.max(0, Math.floor(input.timeSpentSeconds || 0)),
  });

  if (!data || typeof data !== 'object') throw new Error('Answer submission returned no result.');
  return toClientExamAnswer(data);
}

export async function getExamQuestionFeedbackDirect(
  sessionId: string,
  questionId: number,
): Promise<ExamQuestionFeedback> {
  const data = await callExamGateway<RawExamQuestionFeedback, 'feedback'>('feedback', {
    p_session_id: sessionId,
    p_question_id: questionId,
  });

  if (!data || typeof data !== 'object') throw new Error('Question feedback was not returned.');
  return toClientExamFeedback(data);
}

export async function getCompletedExamReviewFeedbackDirect(
  sessionId: string,
  questionId: number,
): Promise<ExamQuestionFeedback> {
  const data = await callExamGateway<RawExamQuestionFeedback, 'reviewFeedback'>('reviewFeedback', {
    p_session_id: sessionId,
    p_question_id: questionId,
  });

  if (!data || typeof data !== 'object') throw new Error('Review feedback was not returned.');
  return toClientExamFeedback(data);
}

export async function setQuestionFlagDirect(questionId: number, flagged: boolean): Promise<void> {
  await callExamGateway<unknown, 'flag'>('flag', {
    p_question_id: questionId,
    p_flagged: flagged,
  });
}

export async function completeExamSessionDirect(sessionId: string): Promise<void> {
  await callExamGateway<unknown, 'complete'>('complete', { p_session_id: sessionId });
}

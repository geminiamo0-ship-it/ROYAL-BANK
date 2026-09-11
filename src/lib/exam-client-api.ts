import { callExamGateway } from '@/lib/exam-gateway-client';
import {
  normalizeExamBootstrap,
  normalizeExamQuestion,
  toClientExamAnswer,
  toClientExamFeedback,
  type RawExamBootstrap,
  type RawExamInlineFeedbackResult,
  type RawExamQuestionFeedback,
  type RawExamSubmitResult,
} from '@/lib/exam-wire';
import { decodeTopicFilter } from '@/lib/topic-filters';
import type {
  ExamBootstrap,
  ExamClientAnswer,
  ExamClientQuestion,
  ExamQuestionFeedback,
  StartExamInput,
} from '@/types/exam';

const inFlightExamCreates = new Map<string, Promise<ExamBootstrap>>();
const sessionTypes = new Map<string, string>();
const prefetchedFeedback = new Map<string, ExamQuestionFeedback>();
const backgroundSubmits = new Map<string, Promise<ExamClientAnswer>>();
const backgroundSubmitFailures = new Map<string, Error>();

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function feedbackKey(sessionId: string, questionId: number): string {
  return `${sessionId}:${questionId}`;
}

function shouldPrefetchFeedback(sessionType: string | undefined): boolean {
  return sessionType === 'standard' || sessionType === 'tutor';
}

function rememberSessionAndFeedback(raw: RawExamBootstrap): void {
  const sessionId = typeof raw.session?.id === 'string' ? raw.session.id : '';
  if (!sessionId) return;

  const sessionType = typeof raw.session?.session_type === 'string'
    ? raw.session.session_type
    : '';
  if (sessionType) sessionTypes.set(sessionId, sessionType);
  rememberPrefetchedFeedback(sessionId, raw.questions);
}

function rememberPrefetchedFeedback(sessionId: string, rawQuestions: unknown): void {
  if (!sessionId || !Array.isArray(rawQuestions)) return;

  for (const rawQuestion of rawQuestions) {
    const question = asObject(rawQuestion);
    const questionId = Number(question?.id);
    const preview = asObject(question?.prefetched_feedback);
    if (!Number.isSafeInteger(questionId) || questionId <= 0 || !preview) continue;

    const correctOptionId = Number(preview.correct_option_id);
    if (!Number.isSafeInteger(correctOptionId) || correctOptionId <= 0) continue;
    if (typeof preview.explanation_html !== 'string') continue;

    const optionPercentages: Record<number, number> = {};
    const rawPercentages = asObject(preview.option_percentages) || {};
    for (const [optionId, percentage] of Object.entries(rawPercentages)) {
      const parsedOptionId = Number(optionId);
      const parsedPercentage = Number(percentage);
      if (!Number.isSafeInteger(parsedOptionId) || parsedOptionId <= 0) continue;
      if (!Number.isFinite(parsedPercentage)) continue;
      optionPercentages[parsedOptionId] = parsedPercentage;
    }

    prefetchedFeedback.set(feedbackKey(sessionId, questionId), {
      questionId,
      selectedOptionId: null,
      isCorrect: false,
      correctOptionId,
      explanationHtml: preview.explanation_html,
      optionPercentages,
    });
  }
}

function normalizeBackgroundError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Unable to save the answer in the background.');
}

function queueBackgroundSubmit(input: {
  sessionId: string;
  questionId: number;
  selectedOptionId: number;
  timeSpentSeconds?: number;
}): void {
  const key = feedbackKey(input.sessionId, input.questionId);
  if (backgroundSubmits.has(key)) return;

  const task = submitExamAnswerDirect(input)
    .then((answer) => {
      backgroundSubmitFailures.delete(key);
      return answer;
    })
    .catch((error) => {
      const normalized = normalizeBackgroundError(error);
      backgroundSubmitFailures.set(key, normalized);
      throw normalized;
    })
    .finally(() => {
      if (backgroundSubmits.get(key) === task) backgroundSubmits.delete(key);
    });

  backgroundSubmits.set(key, task);
  void task.catch(() => undefined);
}

async function flushBackgroundSubmits(sessionId: string): Promise<void> {
  const prefix = `${sessionId}:`;
  const pending = Array.from(backgroundSubmits.entries())
    .filter(([key]) => key.startsWith(prefix))
    .map(([, task]) => task);

  if (pending.length > 0) await Promise.allSettled(pending);

  const failure = Array.from(backgroundSubmitFailures.entries())
    .find(([key]) => key.startsWith(prefix));
  if (failure) throw failure[1];
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

  const requestId = crypto.randomUUID();
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
    rememberSessionAndFeedback(data);
    return normalizeExamBootstrap(data);
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
  rememberSessionAndFeedback(data);
  return normalizeExamBootstrap(data);
}

export async function getCompletedExamReviewBootstrapDirect(sessionId: string): Promise<ExamBootstrap> {
  const data = await callExamGateway<RawExamBootstrap, 'reviewBootstrap'>('reviewBootstrap', {
    p_session_id: sessionId,
  });
  if (!data || typeof data !== 'object') throw new Error('Review bootstrap returned no result.');
  return normalizeExamBootstrap(data);
}

export async function getExamSessionWindowDirect(
  sessionId: string,
  start: number,
  count = 3,
  windowAccessToken?: string | null,
): Promise<ExamClientQuestion[]> {
  // Standard/Tutor intentionally use the normal guarded window path so the same
  // response can preload static feedback. Timed modes keep the signed content-only
  // fast path and never receive correct-answer/explanation data before End Block.
  const useWindowFastPath = !shouldPrefetchFeedback(sessionTypes.get(sessionId));
  const data = await callExamGateway<unknown[], 'window'>(
    'window',
    {
      p_session_id: sessionId,
      p_start: Math.max(0, Math.floor(start)),
      p_count: Math.min(5, Math.max(1, Math.floor(count))),
    },
    { windowAccessToken: useWindowFastPath ? windowAccessToken : null },
  );

  if (!Array.isArray(data)) return [];
  rememberPrefetchedFeedback(sessionId, data);
  return (data as ExamClientQuestion[]).map(normalizeExamQuestion);
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

export async function submitExamAnswerWithFeedbackDirect(input: {
  sessionId: string;
  questionId: number;
  selectedOptionId: number;
  timeSpentSeconds?: number;
}): Promise<{ answer: ExamClientAnswer; feedback: ExamQuestionFeedback }> {
  const cached = prefetchedFeedback.get(feedbackKey(input.sessionId, input.questionId));
  if (cached) {
    const isCorrect = input.selectedOptionId === cached.correctOptionId;
    const timeSpentSeconds = Math.max(0, Math.floor(input.timeSpentSeconds || 0));
    const feedback: ExamQuestionFeedback = {
      ...cached,
      selectedOptionId: input.selectedOptionId,
      isCorrect,
    };

    queueBackgroundSubmit(input);

    return {
      answer: {
        questionId: input.questionId,
        selectedOptionId: input.selectedOptionId,
        isCorrect,
        correctOptionId: cached.correctOptionId,
        timeSpentSeconds,
      },
      feedback,
    };
  }

  // Compatibility fallback if migration 060 is not installed or static feedback was
  // unavailable. Functionality remains correct; only this fallback waits on network.
  const raw = await callExamGateway<RawExamInlineFeedbackResult, 'submit'>('submit', {
    p_session_id: input.sessionId,
    p_question_id: input.questionId,
    p_selected_option_id: input.selectedOptionId,
    p_time_spent_seconds: Math.max(0, Math.floor(input.timeSpentSeconds || 0)),
  });

  if (!raw || typeof raw !== 'object') throw new Error('Answer feedback was not returned.');
  if (!raw.answer || !raw.feedback) throw new Error('Answer feedback payload is incomplete.');

  const feedback = toClientExamFeedback(raw.feedback);
  return {
    answer: {
      ...toClientExamAnswer(raw.answer),
      isCorrect: feedback.isCorrect,
      correctOptionId: feedback.correctOptionId,
    },
    feedback,
  };
}

export async function submitExamAnswerDirect(input: {
  sessionId: string;
  questionId: number;
  selectedOptionId: number;
  timeSpentSeconds?: number;
}): Promise<ExamClientAnswer> {
  const data = await callExamGateway<RawExamSubmitResult, 'submitRaw'>('submitRaw', {
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
  await flushBackgroundSubmits(sessionId);
  await callExamGateway<unknown, 'complete'>('complete', { p_session_id: sessionId });
}

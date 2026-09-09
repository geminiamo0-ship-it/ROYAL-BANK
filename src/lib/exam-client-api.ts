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
  return normalizeExamBootstrap(data);
}

export async function getExamSessionWindowDirect(
  sessionId: string,
  start: number,
  count = 3,
): Promise<ExamClientQuestion[]> {
  const data = await callExamGateway<ExamClientQuestion[], 'window'>('window', {
    p_session_id: sessionId,
    p_start: Math.max(0, Math.floor(start)),
    p_count: Math.min(5, Math.max(1, Math.floor(count))),
  });

  if (!Array.isArray(data)) return [];
  return data.map(normalizeExamQuestion);
}

export async function submitExamAnswerWithFeedbackDirect(input: {
  sessionId: string;
  questionId: number;
  selectedOptionId: number;
  timeSpentSeconds?: number;
}): Promise<{ answer: ExamClientAnswer; feedback: ExamQuestionFeedback }> {
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

export async function setQuestionFlagDirect(questionId: number, flagged: boolean): Promise<void> {
  await callExamGateway<unknown, 'flag'>('flag', {
    p_question_id: questionId,
    p_flagged: flagged,
  });
}

export async function completeExamSessionDirect(sessionId: string): Promise<void> {
  await callExamGateway<unknown, 'complete'>('complete', { p_session_id: sessionId });
}

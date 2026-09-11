'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getExamTrainingFeedbackDirect } from '@/lib/exam-client-api';
import { ExamGatewayError } from '@/lib/exam-gateway-client';
import type { ExamTrainingFeedback } from '@/types/exam';

type FeedbackState = {
  sessionId: string;
  feedbackByQuestionId: Record<number, ExamTrainingFeedback>;
};

type FailureState = {
  attempts: number;
  nextRetryAt: number;
  permanent: boolean;
  error: Error;
};

function feedbackKey(sessionId: string, questionId: number): string {
  return `${sessionId}:${questionId}`;
}

const EMPTY_FEEDBACK: Record<number, ExamTrainingFeedback> = {};
const MAX_AUTOMATIC_ATTEMPTS = 3;
const BASE_RETRY_MS = 1_500;

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Unable to load training feedback.');
}

function isPermanentFailure(error: unknown): boolean {
  return error instanceof ExamGatewayError
    && error.status >= 400
    && error.status < 500
    && error.status !== 408
    && error.status !== 429;
}

function retryDelayMs(error: unknown, attempt: number): number {
  if (error instanceof ExamGatewayError && error.retryAfterSeconds) {
    return Math.max(BASE_RETRY_MS, error.retryAfterSeconds * 1000);
  }
  return Math.min(30_000, BASE_RETRY_MS * (2 ** Math.max(0, attempt - 1)));
}

export function useExamTrainingFeedback(options: {
  sessionId: string;
  enabled: boolean;
  warmQuestionIds: number[];
}) {
  const { sessionId, enabled, warmQuestionIds } = options;
  const [feedbackState, setFeedbackState] = useState<FeedbackState>({
    sessionId,
    feedbackByQuestionId: {},
  });
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const [failureRevision, setFailureRevision] = useState(0);
  const inFlightRef = useRef(new Map<string, Promise<ExamTrainingFeedback>>());
  const failuresRef = useRef(new Map<string, FailureState>());

  const feedbackByQuestionId = feedbackState.sessionId === sessionId
    ? feedbackState.feedbackByQuestionId
    : EMPTY_FEEDBACK;

  const ensureInternal = useCallback((
    questionId: number,
    automatic: boolean,
  ): Promise<ExamTrainingFeedback> => {
    if (feedbackState.sessionId === sessionId) {
      const cached = feedbackState.feedbackByQuestionId[questionId];
      if (cached) return Promise.resolve(cached);
    }

    const key = feedbackKey(sessionId, questionId);
    const existing = inFlightRef.current.get(key);
    if (existing) return existing;

    const failure = failuresRef.current.get(key);
    if (failure?.permanent) return Promise.reject(failure.error);
    if (failure && Date.now() < failure.nextRetryAt) {
      return Promise.reject(failure.error);
    }
    if (automatic && failure && failure.attempts >= MAX_AUTOMATIC_ATTEMPTS) {
      return Promise.reject(failure.error);
    }

    setLoadingKeys((previous) => new Set(previous).add(key));
    const request = getExamTrainingFeedbackDirect(sessionId, questionId)
      .then((feedback) => {
        failuresRef.current.delete(key);
        setFeedbackState((previous) => {
          const base = previous.sessionId === sessionId
            ? previous.feedbackByQuestionId
            : {};
          return {
            sessionId,
            feedbackByQuestionId: { ...base, [questionId]: feedback },
          };
        });
        return feedback;
      })
      .catch((error) => {
        const normalized = normalizeError(error);
        const previous = failuresRef.current.get(key);
        const attempts = (previous?.attempts || 0) + 1;
        failuresRef.current.set(key, {
          attempts,
          nextRetryAt: Date.now() + retryDelayMs(error, attempts),
          permanent: isPermanentFailure(error),
          error: normalized,
        });
        setFailureRevision((revision) => revision + 1);
        throw normalized;
      })
      .finally(() => {
        inFlightRef.current.delete(key);
        setLoadingKeys((previous) => {
          const next = new Set(previous);
          next.delete(key);
          return next;
        });
      });

    inFlightRef.current.set(key, request);
    return request;
  }, [feedbackState, sessionId]);

  const ensure = useCallback(
    (questionId: number) => ensureInternal(questionId, false),
    [ensureInternal],
  );

  const retry = useCallback((questionId: number) => {
    const key = feedbackKey(sessionId, questionId);
    const failure = failuresRef.current.get(key);
    if (failure?.permanent) return Promise.reject(failure.error);
    if (failure && Date.now() < failure.nextRetryAt) {
      setFailureRevision((revision) => revision + 1);
      return Promise.reject(failure.error);
    }
    return ensureInternal(questionId, false);
  }, [ensureInternal, sessionId]);

  const warmKey = useMemo(() => (
    [...new Set(warmQuestionIds.filter((id) => Number.isSafeInteger(id) && id > 0))]
      .slice(0, 3)
      .join(',')
  ), [warmQuestionIds]);

  useEffect(() => {
    if (!enabled || !warmKey) return;

    const questionIds = warmKey.split(',').map(Number);
    let timeoutId: number | null = null;
    let cancelled = false;
    const now = Date.now();
    let earliestRetryAt = Number.POSITIVE_INFINITY;

    for (const questionId of questionIds) {
      if (feedbackByQuestionId[questionId]) continue;
      const failure = failuresRef.current.get(feedbackKey(sessionId, questionId));
      if (failure?.permanent || (failure && failure.attempts >= MAX_AUTOMATIC_ATTEMPTS)) continue;

      if (failure && failure.nextRetryAt > now) {
        earliestRetryAt = Math.min(earliestRetryAt, failure.nextRetryAt);
        continue;
      }

      void ensureInternal(questionId, true).catch(() => undefined);
    }

    if (Number.isFinite(earliestRetryAt)) {
      timeoutId = window.setTimeout(() => {
        if (!cancelled) setFailureRevision((revision) => revision + 1);
      }, Math.max(0, earliestRetryAt - Date.now()));
    }

    return () => {
      cancelled = true;
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, [enabled, ensureInternal, failureRevision, feedbackByQuestionId, sessionId, warmKey]);

  const loadingQuestionIds = useMemo(() => {
    const current = new Set<number>();
    const prefix = `${sessionId}:`;
    for (const key of loadingKeys) {
      if (!key.startsWith(prefix)) continue;
      const questionId = Number(key.slice(prefix.length));
      if (Number.isSafeInteger(questionId) && questionId > 0) current.add(questionId);
    }
    return current;
  }, [loadingKeys, sessionId]);

  return {
    feedbackByQuestionId,
    loadingQuestionIds,
    ensure,
    retry,
  };
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getExamTrainingFeedbackDirect } from '@/lib/exam-client-api';
import type { ExamTrainingFeedback } from '@/types/exam';

type FeedbackState = {
  sessionId: string;
  feedbackByQuestionId: Record<number, ExamTrainingFeedback>;
};

function feedbackKey(sessionId: string, questionId: number): string {
  return `${sessionId}:${questionId}`;
}

const EMPTY_FEEDBACK: Record<number, ExamTrainingFeedback> = {};

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
  const inFlightRef = useRef(new Map<string, Promise<ExamTrainingFeedback>>());

  const feedbackByQuestionId = feedbackState.sessionId === sessionId
    ? feedbackState.feedbackByQuestionId
    : EMPTY_FEEDBACK;

  const ensure = useCallback((questionId: number): Promise<ExamTrainingFeedback> => {
    if (feedbackState.sessionId === sessionId) {
      const cached = feedbackState.feedbackByQuestionId[questionId];
      if (cached) return Promise.resolve(cached);
    }

    const key = feedbackKey(sessionId, questionId);
    const existing = inFlightRef.current.get(key);
    if (existing) return existing;

    setLoadingKeys((previous) => new Set(previous).add(key));
    const request = getExamTrainingFeedbackDirect(sessionId, questionId)
      .then((feedback) => {
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

  useEffect(() => {
    if (!enabled) return;
    const unique = [...new Set(warmQuestionIds.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 3);
    for (const questionId of unique) {
      void ensure(questionId).catch(() => undefined);
    }
  }, [enabled, ensure, warmQuestionIds]);

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
  };
}

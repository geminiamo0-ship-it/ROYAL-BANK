'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getExamTrainingFeedbackDirect } from '@/lib/exam-client-api';
import type { ExamTrainingFeedback } from '@/types/exam';

function feedbackKey(sessionId: string, questionId: number): string {
  return `${sessionId}:${questionId}`;
}

export function useExamTrainingFeedback(options: {
  sessionId: string;
  enabled: boolean;
  warmQuestionIds: number[];
}) {
  const { sessionId, enabled, warmQuestionIds } = options;
  const [cacheRevision, setCacheRevision] = useState(0);
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const feedbackRef = useRef(new Map<string, ExamTrainingFeedback>());
  const inFlightRef = useRef(new Map<string, Promise<ExamTrainingFeedback>>());

  const ensure = useCallback((questionId: number): Promise<ExamTrainingFeedback> => {
    const key = feedbackKey(sessionId, questionId);
    const cached = feedbackRef.current.get(key);
    if (cached) return Promise.resolve(cached);

    const existing = inFlightRef.current.get(key);
    if (existing) return existing;

    setLoadingKeys((previous) => new Set(previous).add(key));
    const request = getExamTrainingFeedbackDirect(sessionId, questionId)
      .then((feedback) => {
        feedbackRef.current.set(key, feedback);
        setCacheRevision((value) => value + 1);
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
  }, [sessionId]);

  useEffect(() => {
    if (!enabled) return;
    const unique = [...new Set(warmQuestionIds.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 3);
    for (const questionId of unique) {
      void ensure(questionId).catch(() => undefined);
    }
  }, [enabled, ensure, warmQuestionIds]);

  const feedbackByQuestionId = useMemo(() => {
    const current: Record<number, ExamTrainingFeedback> = {};
    const prefix = `${sessionId}:`;
    for (const [key, feedback] of feedbackRef.current) {
      if (!key.startsWith(prefix)) continue;
      current[feedback.questionId] = feedback;
    }
    return current;
  }, [cacheRevision, sessionId]);

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

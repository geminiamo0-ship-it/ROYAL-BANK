'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getExamTrainingFeedbackDirect } from '@/lib/exam-client-api';
import type { ExamTrainingFeedback } from '@/types/exam';

export function useExamTrainingFeedback(options: {
  sessionId: string;
  enabled: boolean;
  warmQuestionIds: number[];
}) {
  const { sessionId, enabled, warmQuestionIds } = options;
  const [feedbackByQuestionId, setFeedbackByQuestionId] = useState<Record<number, ExamTrainingFeedback>>({});
  const [loadingQuestionIds, setLoadingQuestionIds] = useState<Set<number>>(new Set());
  const feedbackRef = useRef<Record<number, ExamTrainingFeedback>>({});
  const inFlightRef = useRef(new Map<number, Promise<ExamTrainingFeedback>>());

  useEffect(() => {
    feedbackRef.current = {};
    inFlightRef.current.clear();
    setFeedbackByQuestionId({});
    setLoadingQuestionIds(new Set());
  }, [sessionId]);

  const ensure = useCallback((questionId: number): Promise<ExamTrainingFeedback> => {
    const cached = feedbackRef.current[questionId];
    if (cached) return Promise.resolve(cached);

    const existing = inFlightRef.current.get(questionId);
    if (existing) return existing;

    setLoadingQuestionIds((previous) => new Set(previous).add(questionId));
    const request = getExamTrainingFeedbackDirect(sessionId, questionId)
      .then((feedback) => {
        feedbackRef.current = { ...feedbackRef.current, [questionId]: feedback };
        setFeedbackByQuestionId(feedbackRef.current);
        return feedback;
      })
      .finally(() => {
        inFlightRef.current.delete(questionId);
        setLoadingQuestionIds((previous) => {
          const next = new Set(previous);
          next.delete(questionId);
          return next;
        });
      });

    inFlightRef.current.set(questionId, request);
    return request;
  }, [sessionId]);

  useEffect(() => {
    if (!enabled) return;
    const unique = [...new Set(warmQuestionIds.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 3);
    for (const questionId of unique) {
      void ensure(questionId).catch(() => undefined);
    }
  }, [enabled, ensure, warmQuestionIds]);

  return {
    feedbackByQuestionId,
    loadingQuestionIds,
    ensure,
  };
}

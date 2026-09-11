'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { ExamClientAnswer } from '@/types/exam';

export function useExamQuestionTimer(currentQuestionId: number | null) {
  const accumulatedRef = useRef<Record<number, number>>({});
  const activeQuestionRef = useRef<number | null>(null);
  const activeSinceRef = useRef<number>(performance.now());

  const closeActiveVisit = useCallback((now = performance.now()) => {
    const activeQuestionId = activeQuestionRef.current;
    if (!activeQuestionId) return;
    const elapsed = Math.max(0, Math.floor((now - activeSinceRef.current) / 1000));
    if (elapsed > 0) {
      accumulatedRef.current[activeQuestionId] =
        (accumulatedRef.current[activeQuestionId] || 0) + elapsed;
    }
    activeSinceRef.current = now;
  }, []);

  useEffect(() => {
    const now = performance.now();
    closeActiveVisit(now);
    activeQuestionRef.current = currentQuestionId;
    activeSinceRef.current = now;
  }, [closeActiveVisit, currentQuestionId]);

  const seedFromAnswers = useCallback((answers: Record<number, ExamClientAnswer>) => {
    const seeded: Record<number, number> = {};
    for (const answer of Object.values(answers)) {
      seeded[answer.questionId] = Math.max(0, Math.floor(answer.timeSpentSeconds || 0));
    }
    accumulatedRef.current = seeded;
    activeSinceRef.current = performance.now();
  }, []);

  const elapsedForQuestion = useCallback((questionId: number): number => {
    const accumulated = accumulatedRef.current[questionId] || 0;
    if (activeQuestionRef.current !== questionId) return accumulated;
    return accumulated + Math.max(0, Math.floor((performance.now() - activeSinceRef.current) / 1000));
  }, []);

  return {
    seedFromAnswers,
    elapsedForQuestion,
    closeActiveVisit,
  };
}

'use client';

import { useCallback, useRef, useState } from 'react';
import { setQuestionFlagDirect } from '@/lib/exam-client-api';

export function useExamFlagPersistence(options: {
  initialFlaggedQuestionIds?: number[];
  isSubmitting: boolean;
}) {
  const { initialFlaggedQuestionIds = [], isSubmitting } = options;
  const [flaggedQuestionIds, setFlaggedQuestionIds] = useState<Set<number>>(
    () => new Set(initialFlaggedQuestionIds),
  );
  const [error, setError] = useState<string | null>(null);
  const persistedFlaggedQuestionIdsRef = useRef(new Set(initialFlaggedQuestionIds));
  const generationRef = useRef<Record<number, number>>({});
  const saveChainsRef = useRef<Record<number, Promise<void>>>({});

  const hydrate = useCallback((questionIds: number[]) => {
    const next = new Set(questionIds);
    persistedFlaggedQuestionIdsRef.current = new Set(next);
    setFlaggedQuestionIds(next);
    setError(null);
  }, []);

  const toggle = useCallback((questionId: number) => {
    if (isSubmitting) return;
    const nextFlagged = !flaggedQuestionIds.has(questionId);
    const generation = (generationRef.current[questionId] || 0) + 1;
    generationRef.current[questionId] = generation;

    setFlaggedQuestionIds((previous) => {
      const next = new Set(previous);
      if (nextFlagged) next.add(questionId);
      else next.delete(questionId);
      return next;
    });

    const previousSave = saveChainsRef.current[questionId] || Promise.resolve();
    const nextSave = previousSave
      .catch(() => undefined)
      .then(() => setQuestionFlagDirect(questionId, nextFlagged))
      .then(() => {
        if (generationRef.current[questionId] !== generation) return;
        const persisted = new Set(persistedFlaggedQuestionIdsRef.current);
        if (nextFlagged) persisted.add(questionId);
        else persisted.delete(questionId);
        persistedFlaggedQuestionIdsRef.current = persisted;
        setError(null);
      })
      .catch((saveError) => {
        if (generationRef.current[questionId] === generation) {
          const persistedFlagged = persistedFlaggedQuestionIdsRef.current.has(questionId);
          setFlaggedQuestionIds((previous) => {
            const next = new Set(previous);
            if (persistedFlagged) next.add(questionId);
            else next.delete(questionId);
            return next;
          });
          setError(saveError instanceof Error ? saveError.message : 'Unable to update the question flag.');
        }
        throw saveError;
      });

    saveChainsRef.current[questionId] = nextSave;
  }, [flaggedQuestionIds, isSubmitting]);

  const drain = useCallback(async () => {
    await Promise.all(Object.values(saveChainsRef.current));
  }, []);

  return {
    flaggedQuestionIds,
    error,
    hydrate,
    toggle,
    drain,
  };
}

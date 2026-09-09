'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getExamSessionBootstrapDirect, getExamSessionWindowDirect } from '@/lib/exam-client-api';
import {
  getExamLaunchCache,
  mergeExamLaunchWindow,
  primeExamLaunchCache,
} from '@/lib/exam-launch-cache';
import type { ExamBootstrap, ExamBootstrapSession, ExamClientQuestion } from '@/types/exam';

export function useWindowedExamSession({
  sessionId,
  onBootstrap,
  onError,
}: {
  sessionId: string;
  onBootstrap: (bootstrap: ExamBootstrap) => void;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const [session, setSession] = useState<ExamBootstrapSession | null>(null);
  const [questionIds, setQuestionIds] = useState<number[]>([]);
  const [questionsById, setQuestionsById] = useState<Record<number, ExamClientQuestion>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [loadingQuestionIndex, setLoadingQuestionIndex] = useState<number | null>(null);

  const questionIdsRef = useRef<number[]>([]);
  const questionsByIdRef = useRef<Record<number, ExamClientQuestion>>({});
  const prefetchCursorRef = useRef(0);
  const prefetchChainRef = useRef<Promise<void>>(Promise.resolve());

  const addQuestions = useCallback((questions: ExamClientQuestion[]) => {
    if (questions.length === 0) return;

    const nextRef = { ...questionsByIdRef.current };
    for (const question of questions) nextRef[question.id] = question;
    questionsByIdRef.current = nextRef;
    setQuestionsById(nextRef);
    mergeExamLaunchWindow(sessionId, questions);
  }, [sessionId]);

  const loadWindow = useCallback(async (start: number, count: number) => {
    if (count <= 0 || start >= questionIdsRef.current.length) return [];
    const questions = await getExamSessionWindowDirect(sessionId, start, count);
    addQuestions(questions);
    return questions;
  }, [addQuestions, sessionId]);

  const queuePrefetch = useCallback((count = 2) => {
    prefetchChainRef.current = prefetchChainRef.current
      .catch(() => undefined)
      .then(async () => {
        const ids = questionIdsRef.current;
        const start = prefetchCursorRef.current;
        if (start >= ids.length) return;

        const end = Math.min(start + count, ids.length);
        let firstMissing = -1;
        for (let index = start; index < end; index += 1) {
          if (!questionsByIdRef.current[ids[index]]) {
            firstMissing = index;
            break;
          }
        }

        if (firstMissing >= 0) {
          await loadWindow(firstMissing, end - firstMissing);
        }
        prefetchCursorRef.current = end;
      });
  }, [loadWindow]);

  const applyBootstrap = useCallback((
    bootstrap: ExamBootstrap,
    cachedQuestions?: Record<number, ExamClientQuestion>,
  ) => {
    if (bootstrap.status === 'completed' || bootstrap.session.is_completed) {
      router.replace(`/bank/${bootstrap.session.question_bank_id}/fixed-sets`);
      return;
    }

    const loaded: Record<number, ExamClientQuestion> = { ...(cachedQuestions || {}) };
    for (const question of bootstrap.questions) loaded[question.id] = question;

    const safeIndex = Math.min(
      Math.max(0, bootstrap.currentIndex),
      Math.max(bootstrap.questionIds.length - 1, 0),
    );

    setSession(bootstrap.session);
    setQuestionIds(bootstrap.questionIds);
    questionIdsRef.current = bootstrap.questionIds;
    setQuestionsById(loaded);
    questionsByIdRef.current = loaded;
    setCurrentIndex(safeIndex);
    prefetchCursorRef.current = Math.min(safeIndex + 1, bootstrap.questionIds.length);
    onBootstrap(bootstrap);
    setIsBootstrapping(false);
    queuePrefetch(2);
  }, [onBootstrap, queuePrefetch, router]);

  useEffect(() => {
    let cancelled = false;
    const cached = getExamLaunchCache(sessionId);

    void Promise.resolve().then(async () => {
      if (cancelled) return;

      if (cached) {
        applyBootstrap(cached.bootstrap, cached.questionsById);
        return;
      }

      setIsBootstrapping(true);

      try {
        const bootstrap = await getExamSessionBootstrapDirect(sessionId);
        if (cancelled) return;
        primeExamLaunchCache(bootstrap);
        applyBootstrap(bootstrap);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Unable to load the exam session.';
        if (/not authenticated|jwt|authentication/i.test(message)) {
          router.replace('/login');
          return;
        }
        onError(message);
        setIsBootstrapping(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [applyBootstrap, onError, router, sessionId]);

  const goToIndex = useCallback(async (targetIndex: number) => {
    const ids = questionIdsRef.current;
    if (targetIndex < 0 || targetIndex >= ids.length) return;

    const targetId = ids[targetIndex];
    if (questionsByIdRef.current[targetId]) {
      setCurrentIndex(targetIndex);
      return;
    }

    setLoadingQuestionIndex(targetIndex);
    try {
      await loadWindow(targetIndex, Math.min(3, ids.length - targetIndex));
      if (questionsByIdRef.current[targetId]) setCurrentIndex(targetIndex);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Unable to load the question.');
    } finally {
      setLoadingQuestionIndex(null);
    }
  }, [loadWindow, onError]);

  const goNext = useCallback(() => {
    void goToIndex(Math.min(currentIndex + 1, questionIdsRef.current.length - 1));
  }, [currentIndex, goToIndex]);

  const goPrev = useCallback(() => {
    void goToIndex(Math.max(currentIndex - 1, 0));
  }, [currentIndex, goToIndex]);

  const getQuestionById = useCallback(
    (questionId: number) => questionsByIdRef.current[questionId],
    [],
  );
  const currentQuestionId = questionIds[currentIndex];
  const currentQuestion = currentQuestionId ? questionsById[currentQuestionId] : undefined;

  return {
    session,
    questionIds,
    currentIndex,
    currentQuestion,
    isBootstrapping,
    loadingQuestionIndex,
    goNext,
    goPrev,
    queuePrefetch,
    getQuestionById,
  };
}

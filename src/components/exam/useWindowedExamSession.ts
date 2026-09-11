'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getCompletedExamReviewBootstrapDirect,
  getCompletedExamReviewWindowDirect,
  getExamSessionBootstrapDirect,
  getExamSessionWindowDirect,
} from '@/lib/exam-client-api';
import {
  getExamLaunchCache,
  mergeExamLaunchWindow,
  primeExamLaunchCache,
} from '@/lib/exam-launch-cache';
import type { ExamBootstrap, ExamBootstrapSession, ExamClientQuestion } from '@/types/exam';

const DEFAULT_WARM_AHEAD = 3;
const WINDOW_ACCESS_REFRESH_MS = 5 * 60 * 1000;

export function useWindowedExamSession({
  sessionId,
  reviewMode = false,
  onBootstrap,
  onError,
}: {
  sessionId: string;
  reviewMode?: boolean;
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
  const currentIndexRef = useRef(0);
  const prefetchChainRef = useRef<Promise<void>>(Promise.resolve());
  const windowAccessTokenRef = useRef<string | null>(null);
  const windowAccessRefreshRef = useRef<Promise<void> | null>(null);

  const addQuestions = useCallback((questions: ExamClientQuestion[]) => {
    if (questions.length === 0) return;

    const nextRef = { ...questionsByIdRef.current };
    for (const question of questions) nextRef[question.id] = question;
    questionsByIdRef.current = nextRef;
    setQuestionsById(nextRef);
    if (!reviewMode) mergeExamLaunchWindow(sessionId, questions);
  }, [reviewMode, sessionId]);

  const loadWindow = useCallback(async (start: number, count: number) => {
    if (count <= 0 || start >= questionIdsRef.current.length) return [];
    const accessToken = windowAccessTokenRef.current;
    const questions = reviewMode
      ? await getCompletedExamReviewWindowDirect(sessionId, start, count, accessToken)
      : await getExamSessionWindowDirect(sessionId, start, count, accessToken);
    addQuestions(questions);
    return questions;
  }, [addQuestions, reviewMode, sessionId]);

  const queuePrefetch = useCallback((count = DEFAULT_WARM_AHEAD) => {
    const warmCount = Math.min(5, Math.max(1, Math.floor(count)));
    prefetchChainRef.current = prefetchChainRef.current
      .catch(() => undefined)
      .then(async () => {
        const ids = questionIdsRef.current;
        const start = currentIndexRef.current + 1;
        if (start >= ids.length) return;

        const end = Math.min(start + warmCount, ids.length);
        let firstMissing = -1;
        for (let index = start; index < end; index += 1) {
          if (!questionsByIdRef.current[ids[index]]) {
            firstMissing = index;
            break;
          }
        }

        if (firstMissing >= 0) {
          await loadWindow(firstMissing, Math.min(warmCount, ids.length - firstMissing));
        }
      });
  }, [loadWindow]);

  const updateWindowAccess = useCallback((bootstrap: ExamBootstrap) => {
    windowAccessTokenRef.current = bootstrap.windowAccessToken;
  }, []);

  const refreshWindowAccess = useCallback(() => {
    if (windowAccessRefreshRef.current) return windowAccessRefreshRef.current;

    const refresh = (async () => {
      try {
        const bootstrap = reviewMode
          ? await getCompletedExamReviewBootstrapDirect(sessionId)
          : await getExamSessionBootstrapDirect(sessionId);
        updateWindowAccess(bootstrap);
      } catch {
        // A stale or unavailable access token only disables the fast path. The
        // regular authenticated reference path remains the automatic fallback.
      }
    })();

    windowAccessRefreshRef.current = refresh;
    void refresh.finally(() => {
      if (windowAccessRefreshRef.current === refresh) {
        windowAccessRefreshRef.current = null;
      }
    });
    return refresh;
  }, [reviewMode, sessionId, updateWindowAccess]);

  const applyBootstrap = useCallback((
    bootstrap: ExamBootstrap,
    cachedQuestions?: Record<number, ExamClientQuestion>,
  ) => {
    if ((bootstrap.status === 'completed' || bootstrap.session.is_completed) && !reviewMode) {
      router.replace(`/bank/${bootstrap.session.question_bank_id}/sessions`);
      return;
    }

    const loaded: Record<number, ExamClientQuestion> = { ...(cachedQuestions || {}) };
    for (const question of bootstrap.questions) loaded[question.id] = question;

    const safeIndex = reviewMode
      ? 0
      : Math.min(
          Math.max(0, bootstrap.currentIndex),
          Math.max(bootstrap.questionIds.length - 1, 0),
        );

    setSession(bootstrap.session);
    setQuestionIds(bootstrap.questionIds);
    questionIdsRef.current = bootstrap.questionIds;
    setQuestionsById(loaded);
    questionsByIdRef.current = loaded;
    currentIndexRef.current = safeIndex;
    setCurrentIndex(safeIndex);
    updateWindowAccess(bootstrap);
    onBootstrap(bootstrap);
    setIsBootstrapping(false);
    queuePrefetch(DEFAULT_WARM_AHEAD);
  }, [onBootstrap, queuePrefetch, reviewMode, router, updateWindowAccess]);

  useEffect(() => {
    let cancelled = false;
    const cached = reviewMode ? null : getExamLaunchCache(sessionId);

    void Promise.resolve().then(async () => {
      if (cancelled) return;

      if (cached) {
        applyBootstrap(cached.bootstrap, cached.questionsById);
        return;
      }

      setIsBootstrapping(true);

      try {
        const bootstrap = reviewMode
          ? await getCompletedExamReviewBootstrapDirect(sessionId)
          : await getExamSessionBootstrapDirect(sessionId);
        if (cancelled) return;
        if (!reviewMode) primeExamLaunchCache(bootstrap);
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
  }, [applyBootstrap, onError, reviewMode, router, sessionId]);

  useEffect(() => {
    if (isBootstrapping) return;

    const intervalId = window.setInterval(() => {
      void refreshWindowAccess();
    }, WINDOW_ACCESS_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [isBootstrapping, refreshWindowAccess]);

  const goToIndex = useCallback(async (targetIndex: number) => {
    const ids = questionIdsRef.current;
    if (targetIndex < 0 || targetIndex >= ids.length) return;

    const targetId = ids[targetIndex];
    if (questionsByIdRef.current[targetId]) {
      currentIndexRef.current = targetIndex;
      setCurrentIndex(targetIndex);
      queuePrefetch(DEFAULT_WARM_AHEAD);
      return;
    }

    setLoadingQuestionIndex(targetIndex);
    try {
      await loadWindow(targetIndex, Math.min(4, ids.length - targetIndex));
      if (questionsByIdRef.current[targetId]) {
        currentIndexRef.current = targetIndex;
        setCurrentIndex(targetIndex);
        queuePrefetch(DEFAULT_WARM_AHEAD);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Unable to load the question.');
    } finally {
      setLoadingQuestionIndex(null);
    }
  }, [loadWindow, onError, queuePrefetch]);

  const goNext = useCallback(() => {
    void goToIndex(Math.min(currentIndexRef.current + 1, questionIdsRef.current.length - 1));
  }, [goToIndex]);

  const goPrev = useCallback(() => {
    void goToIndex(Math.max(currentIndexRef.current - 1, 0));
  }, [goToIndex]);

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

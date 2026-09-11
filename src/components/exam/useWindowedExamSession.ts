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
const WINDOW_ACCESS_RENEW_BEFORE_SECONDS = 60;
const MIN_WINDOW_ACCESS_REFRESH_DELAY_MS = 15_000;

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
  const [windowAccessExpiresAt, setWindowAccessExpiresAt] = useState<number | null>(null);

  const questionIdsRef = useRef<number[]>([]);
  const questionsByIdRef = useRef<Record<number, ExamClientQuestion>>({});
  const currentIndexRef = useRef(0);
  const prefetchChainRef = useRef<Promise<void>>(Promise.resolve());
  const inFlightWindowsRef = useRef(new Map<string, Promise<ExamClientQuestion[]>>());
  const navigationGenerationRef = useRef(0);
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

  const loadWindow = useCallback((start: number, count: number) => {
    if (count <= 0 || start >= questionIdsRef.current.length) {
      return Promise.resolve<ExamClientQuestion[]>([]);
    }

    const boundedCount = Math.min(5, count, questionIdsRef.current.length - start);
    const accessToken = windowAccessTokenRef.current;
    const key = `${reviewMode ? 'review' : 'active'}:${start}:${boundedCount}:${accessToken || 'auth'}`;
    const existing = inFlightWindowsRef.current.get(key);
    if (existing) return existing;

    const request = (async () => {
      const questions = reviewMode
        ? await getCompletedExamReviewWindowDirect(sessionId, start, boundedCount, accessToken)
        : await getExamSessionWindowDirect(sessionId, start, boundedCount, accessToken);
      addQuestions(questions);
      return questions;
    })();

    inFlightWindowsRef.current.set(key, request);
    void request.finally(() => {
      if (inFlightWindowsRef.current.get(key) === request) {
        inFlightWindowsRef.current.delete(key);
      }
    });
    return request;
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

        if (firstMissing < 0) return;

        const countToLoad = Math.min(warmCount, ids.length - firstMissing);
        try {
          await loadWindow(firstMissing, countToLoad);
        } catch {
          // One bounded retry handles a transient read failure without turning a
          // speculative prefetch into a user-visible navigation failure.
          try {
            await loadWindow(firstMissing, countToLoad);
          } catch (error) {
            if (process.env.NODE_ENV !== 'production') {
              console.warn('[royal-exam-prefetch] window prefetch failed', error);
            }
          }
        }
      });
  }, [loadWindow]);

  const updateWindowAccess = useCallback((bootstrap: ExamBootstrap) => {
    windowAccessTokenRef.current = bootstrap.windowAccessToken;
    setWindowAccessExpiresAt(bootstrap.windowAccessExpiresAt);
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
        // An unavailable capability only disables the fast path. Normal
        // authenticated reads remain the fallback.
        windowAccessTokenRef.current = null;
        setWindowAccessExpiresAt(null);
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
  }, [onBootstrap, reviewMode, router, updateWindowAccess]);

  useEffect(() => {
    let cancelled = false;
    const cached = reviewMode ? null : getExamLaunchCache(sessionId);

    void Promise.resolve().then(async () => {
      if (cancelled) return;

      if (cached) {
        applyBootstrap(cached.bootstrap, cached.questionsById);
        if (cached.pendingWindow) {
          const questions = await cached.pendingWindow;
          if (cancelled) return;
          addQuestions(questions);
        }
        if (!cancelled) queuePrefetch(DEFAULT_WARM_AHEAD);
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
        queuePrefetch(DEFAULT_WARM_AHEAD);
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
      navigationGenerationRef.current += 1;
    };
  }, [addQuestions, applyBootstrap, onError, queuePrefetch, reviewMode, router, sessionId]);

  useEffect(() => {
    if (isBootstrapping || !windowAccessExpiresAt) return;

    const refreshAtMs = (windowAccessExpiresAt - WINDOW_ACCESS_RENEW_BEFORE_SECONDS) * 1000;
    const delay = Math.max(MIN_WINDOW_ACCESS_REFRESH_DELAY_MS, refreshAtMs - Date.now());
    const timeoutId = window.setTimeout(() => {
      if (document.visibilityState === 'hidden') return;
      void refreshWindowAccess();
    }, delay);

    return () => window.clearTimeout(timeoutId);
  }, [isBootstrapping, refreshWindowAccess, windowAccessExpiresAt]);

  useEffect(() => {
    if (isBootstrapping) return;
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (!windowAccessExpiresAt) return;
      if (windowAccessExpiresAt <= Math.floor(Date.now() / 1000) + WINDOW_ACCESS_RENEW_BEFORE_SECONDS) {
        void refreshWindowAccess();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [isBootstrapping, refreshWindowAccess, windowAccessExpiresAt]);

  const goToIndex = useCallback(async (targetIndex: number) => {
    const ids = questionIdsRef.current;
    if (targetIndex < 0 || targetIndex >= ids.length) return;

    const generation = ++navigationGenerationRef.current;
    const targetId = ids[targetIndex];
    if (questionsByIdRef.current[targetId]) {
      currentIndexRef.current = targetIndex;
      setCurrentIndex(targetIndex);
      setLoadingQuestionIndex(null);
      queuePrefetch(DEFAULT_WARM_AHEAD);
      return;
    }

    setLoadingQuestionIndex(targetIndex);
    try {
      await loadWindow(targetIndex, Math.min(4, ids.length - targetIndex));
      if (generation !== navigationGenerationRef.current) return;
      if (questionsByIdRef.current[targetId]) {
        currentIndexRef.current = targetIndex;
        setCurrentIndex(targetIndex);
        queuePrefetch(DEFAULT_WARM_AHEAD);
      }
    } catch (error) {
      if (generation !== navigationGenerationRef.current) return;
      onError(error instanceof Error ? error.message : 'Unable to load the question.');
    } finally {
      if (generation === navigationGenerationRef.current) {
        setLoadingQuestionIndex(null);
      }
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

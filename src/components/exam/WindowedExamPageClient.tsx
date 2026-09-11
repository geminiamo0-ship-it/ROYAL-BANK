'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ExamHeader } from '@/components/exam/ExamHeader';
import { WindowedExamQuestionPane } from '@/components/exam/WindowedExamQuestionPane';
import { WindowedExamSidebarWidgets } from '@/components/exam/WindowedExamSidebarWidgets';
import { useExamAnswerWriteQueue } from '@/components/exam/useExamAnswerWriteQueue';
import { useExamConceptBookmark } from '@/components/exam/useExamConceptBookmark';
import { useExamKeyboardShortcuts } from '@/components/exam/useExamKeyboardShortcuts';
import { useExamQuestionTimer } from '@/components/exam/useExamQuestionTimer';
import { useExamTrainingFeedback } from '@/components/exam/useExamTrainingFeedback';
import { useQuestionAnnotations } from '@/components/exam/useQuestionAnnotations';
import { useWindowedExamSession } from '@/components/exam/useWindowedExamSession';
import {
  completeExamSessionDirect,
  getCompletedExamReviewFeedbackDirect,
  setQuestionFlagDirect,
} from '@/lib/exam-client-api';
import type { AnnotationTool } from '@/lib/exam-annotations';
import { prepareQuestionStemHtml, rewriteExamMediaHtml } from '@/lib/exam-html';
import { examModeCapabilities } from '@/lib/exam-mode-capabilities';
import { extractExplanationPanels } from '@/lib/explanation-panels';
import type {
  ExamBootstrap,
  ExamClientAnswer,
  ExamClientOption,
  ExamQuestionFeedback,
  ExamTrainingFeedback,
} from '@/types/exam';

interface WindowedExamPageClientProps {
  sessionId: string;
  reviewMode?: boolean;
}

function feedbackFromTraining(
  training: ExamTrainingFeedback,
  selectedOptionId: number,
): ExamQuestionFeedback {
  return {
    questionId: training.questionId,
    selectedOptionId,
    isCorrect:
      training.correctOptionId != null && selectedOptionId === training.correctOptionId,
    correctOptionId: training.correctOptionId,
    explanationHtml: training.explanationHtml,
    optionPercentages: training.optionPercentages,
  };
}

function authoritativeNow(offsetMs: number): number {
  return Date.now() + offsetMs;
}

export function WindowedExamPageClient({
  sessionId,
  reviewMode = false,
}: WindowedExamPageClientProps) {
  const router = useRouter();
  const examRootRef = useRef<HTMLDivElement>(null);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const serverClockOffsetMsRef = useRef(0);
  const startedAtMsRef = useRef<number | null>(null);
  const deadlineAtMsRef = useRef<number | null>(null);
  const fallbackClockStartedAtRef = useRef(Date.now());
  const timerSeededSessionRef = useRef<string | null>(null);
  const autoSubmitStartedRef = useRef(false);
  const bootstrapAnswersRef = useRef<Record<number, ExamClientAnswer>>({});

  const [answers, setAnswers] = useState<Record<number, ExamClientAnswer>>({});
  const [pendingSelections, setPendingSelections] = useState<Record<number, number | null>>({});
  const [flaggedQuestionIds, setFlaggedQuestionIds] = useState<Set<number>>(new Set());
  const [struckOutOptionIds, setStruckOutOptionIds] = useState<Set<number>>(new Set());
  const [showClues, setShowClues] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [revealingQuestionIds, setRevealingQuestionIds] = useState<Set<number>>(new Set());
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedbackByQuestionId, setFeedbackByQuestionId] = useState<Record<number, ExamQuestionFeedback>>({});
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sidebarStickyTop, setSidebarStickyTop] = useState(0);

  const flagSaveChains = useRef<Record<number, Promise<void>>>({});
  const reviewFeedbackFetchingIds = useRef(new Set<number>());

  const applyBootstrapState = useCallback((bootstrap: ExamBootstrap) => {
    setAnswers(bootstrap.answers);
    bootstrapAnswersRef.current = bootstrap.answers;
    setFlaggedQuestionIds(new Set(bootstrap.flaggedQuestionIds));

    const serverNowMs = bootstrap.serverNow ? Date.parse(bootstrap.serverNow) : Number.NaN;
    serverClockOffsetMsRef.current = Number.isFinite(serverNowMs)
      ? serverNowMs - Date.now()
      : 0;

    const startedAtMs = bootstrap.session.started_at
      ? Date.parse(bootstrap.session.started_at)
      : Number.NaN;
    const deadlineAtMs = bootstrap.session.deadline_at
      ? Date.parse(bootstrap.session.deadline_at)
      : Number.NaN;
    startedAtMsRef.current = Number.isFinite(startedAtMs) ? startedAtMs : null;
    deadlineAtMsRef.current = Number.isFinite(deadlineAtMs) ? deadlineAtMs : null;
    fallbackClockStartedAtRef.current = Date.now();
    autoSubmitStartedRef.current = false;

    const now = authoritativeNow(serverClockOffsetMsRef.current);
    if (deadlineAtMsRef.current != null) {
      setElapsedSeconds(Math.max(0, Math.ceil((deadlineAtMsRef.current - now) / 1000)));
    } else if (startedAtMsRef.current != null) {
      setElapsedSeconds(Math.max(0, Math.floor((now - startedAtMsRef.current) / 1000)));
    } else {
      setElapsedSeconds(0);
    }
  }, []);

  const reportPersistenceError = useCallback((message: string) => {
    setPersistenceError(message);
  }, []);

  const {
    session,
    questionIds,
    currentIndex,
    currentQuestion: currentQ,
    isBootstrapping,
    loadingQuestionIndex,
    goNext,
    goPrev,
    queuePrefetch,
    getQuestionById,
  } = useWindowedExamSession({
    sessionId,
    reviewMode,
    onBootstrap: applyBootstrapState,
    onError: reportPersistenceError,
  });

  const questionTimer = useExamQuestionTimer(currentQ?.id || null);

  useEffect(() => {
    if (!session || timerSeededSessionRef.current === session.id) return;
    questionTimer.seedFromAnswers(bootstrapAnswersRef.current);
    timerSeededSessionRef.current = session.id;
  }, [questionTimer, session]);

  const handleAnswerConfirmed = useCallback((confirmed: ExamClientAnswer) => {
    setAnswers((previous) => {
      const current = previous[confirmed.questionId];
      if (current && current.selectedOptionId !== confirmed.selectedOptionId) return previous;
      return {
        ...previous,
        [confirmed.questionId]: {
          ...confirmed,
          isCorrect: confirmed.isCorrect ?? current?.isCorrect ?? null,
          correctOptionId: confirmed.correctOptionId ?? current?.correctOptionId ?? null,
        },
      };
    });
  }, []);

  const answerQueue = useExamAnswerWriteQueue({
    sessionId,
    disabled: reviewMode,
    onConfirmed: handleAnswerConfirmed,
  });

  const {
    records: annotationRecords,
    isLoading: annotationLoading,
    isSaving: annotationSaving,
    error: annotationError,
    canUndo: canUndoAnnotation,
    canRedo: canRedoAnnotation,
    appendStroke: appendAnnotationStroke,
    eraseStroke: eraseAnnotationStroke,
    undo: undoAnnotation,
    redo: redoAnnotation,
    clearAll: clearAllAnnotations,
    flush: flushAnnotations,
  } = useQuestionAnnotations(currentQ?.id || null);

  const isReviewMode = reviewMode && session?.is_completed === true;
  const sessionType = session?.session_type ?? 'standard';
  const capabilities = examModeCapabilities(sessionType);
  const isFeedbackLockedMode = !isReviewMode && !capabilities.canSeeFeedbackBeforeCompletion;
  const isCountdownSession =
    !isReviewMode && (sessionType === 'timed' || sessionType === 'fixed_timed');
  const bankId = Number(session?.question_bank_id || 0);

  const trainingWarmQuestionIds = capabilities.canPrefetchFeedback && !isReviewMode
    ? questionIds
        .slice(currentIndex, currentIndex + 3)
        .filter((questionId) => Boolean(getQuestionById(questionId)))
    : [];

  const {
    feedbackByQuestionId: trainingFeedbackByQuestionId,
    ensure: ensureTrainingFeedback,
  } = useExamTrainingFeedback({
    sessionId,
    enabled: capabilities.canPrefetchFeedback && !isReviewMode,
    warmQuestionIds: trainingWarmQuestionIds,
  });

  const {
    isBookmarked: isCurrentConceptBookmarked,
    toggleBookmark: toggleConceptBookmark,
  } = useExamConceptBookmark(currentQ);

  useEffect(() => {
    mainScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [currentQ?.id]);

  useEffect(() => {
    const scrollContainer = mainScrollRef.current;
    const sidebar = sidebarRef.current;
    if (!scrollContainer || !sidebar) return;

    const updateStickyTop = () => {
      const availableHeight = scrollContainer.clientHeight;
      const sidebarHeight = sidebar.scrollHeight;
      setSidebarStickyTop(Math.min(0, availableHeight - sidebarHeight - 12));
    };

    updateStickyTop();
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(updateStickyTop);
    observer.observe(scrollContainer);
    observer.observe(sidebar);
    window.addEventListener('resize', updateStickyTop);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateStickyTop);
    };
  }, [currentQ?.id]);

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(document.fullscreenElement === examRootRef.current);
    };
    document.addEventListener('fullscreenchange', syncFullscreenState);
    syncFullscreenState();
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (examRootRef.current) {
        await examRootRef.current.requestFullscreen();
      }
      setPersistenceError(null);
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : 'Unable to change full-screen mode.');
    }
  }, []);

  const selectOption = useCallback((questionId: number, option: ExamClientOption) => {
    if (isReviewMode || isSubmitting) return;
    if (!capabilities.canChangeAnswerBeforeCompletion && answers[questionId]) return;

    setPendingSelections((previous) => ({ ...previous, [questionId]: option.id }));
    if (!isFeedbackLockedMode) return;

    const timeSpentSeconds = questionTimer.elapsedForQuestion(questionId);
    const answer: ExamClientAnswer = {
      questionId,
      selectedOptionId: option.id,
      isCorrect: null,
      correctOptionId: null,
      timeSpentSeconds,
    };

    setAnswers((previous) => ({ ...previous, [questionId]: answer }));
    void answerQueue.enqueue({
      questionId,
      selectedOptionId: option.id,
      timeSpentSeconds,
    }).catch(() => undefined);
  }, [answerQueue, answers, capabilities.canChangeAnswerBeforeCompletion, isFeedbackLockedMode, isReviewMode, isSubmitting, questionTimer]);

  const submitAnswer = useCallback(async (questionId: number) => {
    if (
      isReviewMode ||
      isFeedbackLockedMode ||
      isSubmitting ||
      answers[questionId] ||
      revealingQuestionIds.has(questionId)
    ) return;

    const selectedOptionId = pendingSelections[questionId];
    if (!selectedOptionId) return;

    const question = getQuestionById(questionId);
    const option = question?.options?.find((item) => item.id === selectedOptionId);
    if (!option) return;

    setRevealingQuestionIds((previous) => new Set(previous).add(questionId));
    setPersistenceError(null);

    try {
      const training =
        trainingFeedbackByQuestionId[questionId] ||
        await ensureTrainingFeedback(questionId);
      const feedback = feedbackFromTraining(training, option.id);
      const timeSpentSeconds = questionTimer.elapsedForQuestion(questionId);
      const optimisticAnswer: ExamClientAnswer = {
        questionId,
        selectedOptionId: option.id,
        isCorrect: feedback.isCorrect,
        correctOptionId: feedback.correctOptionId,
        timeSpentSeconds,
      };

      // Feedback is already authorized and prefetched for Standard/Tutor. Commit
      // the visual state before starting the write so the Submit -> feedback path
      // has no save/network dependency when the prefetch is warm.
      setAnswers((previous) => ({ ...previous, [questionId]: optimisticAnswer }));
      setFeedbackByQuestionId((previous) => ({ ...previous, [questionId]: feedback }));
      queuePrefetch(3);

      void answerQueue.enqueue({
        questionId,
        selectedOptionId: option.id,
        timeSpentSeconds,
      }).catch(() => undefined);
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : 'Unable to prepare answer feedback.');
    } finally {
      setRevealingQuestionIds((previous) => {
        const next = new Set(previous);
        next.delete(questionId);
        return next;
      });
    }
  }, [answerQueue, answers, ensureTrainingFeedback, getQuestionById, isFeedbackLockedMode, isReviewMode, isSubmitting, pendingSelections, questionTimer, queuePrefetch, revealingQuestionIds, trainingFeedbackByQuestionId]);

  const toggleFlag = useCallback((questionId: number) => {
    if (isSubmitting) return;
    const nextFlagged = !flaggedQuestionIds.has(questionId);

    setFlaggedQuestionIds((previous) => {
      const next = new Set(previous);
      if (nextFlagged) next.add(questionId);
      else next.delete(questionId);
      return next;
    });

    const previousSave = flagSaveChains.current[questionId] || Promise.resolve();
    const nextSave = previousSave
      .catch(() => undefined)
      .then(() => setQuestionFlagDirect(questionId, nextFlagged))
      .catch((error) => {
        setPersistenceError(error instanceof Error ? error.message : 'Unable to update the question flag.');
        throw error;
      });

    flagSaveChains.current[questionId] = nextSave;
  }, [flaggedQuestionIds, isSubmitting]);

  const toggleStrikeOut = useCallback((optionId: number) => {
    if (isReviewMode || isSubmitting) return;
    setStruckOutOptionIds((previous) => {
      const next = new Set(previous);
      if (next.has(optionId)) next.delete(optionId);
      else next.add(optionId);
      return next;
    });
  }, [isReviewMode, isSubmitting]);

  const handleNext = useCallback(async () => {
    try {
      await flushAnnotations();
      goNext();
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : 'Unable to save annotations before moving on.');
    }
  }, [flushAnnotations, goNext]);

  const handlePrev = useCallback(async () => {
    try {
      await flushAnnotations();
      goPrev();
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : 'Unable to save annotations before moving back.');
    }
  }, [flushAnnotations, goPrev]);

  const handleClearAnnotations = useCallback(async () => {
    if (!currentQ) return;
    if (!window.confirm('Clear all pencil and highlighter marks for this question?')) return;
    try {
      await clearAllAnnotations();
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : 'Unable to clear annotations.');
    }
  }, [clearAllAnnotations, currentQ]);

  const handleSuspend = useCallback(async () => {
    if (isReviewMode) {
      try {
        await flushAnnotations();
        router.push(bankId > 0 ? `/bank/${bankId}/sessions` : '/dashboard');
      } catch (error) {
        setPersistenceError(error instanceof Error ? error.message : 'Unable to save annotations before leaving review.');
      }
      return;
    }

    if (!window.confirm('Suspend this block and return later?')) return;

    setIsSubmitting(true);
    setPersistenceError(null);
    try {
      await flushAnnotations();
      await answerQueue.drain();
      await Promise.all(Object.values(flagSaveChains.current));
      router.push(bankId > 0 ? `/bank/${bankId}/sessions` : '/dashboard');
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : 'Unable to suspend the block safely.');
      setIsSubmitting(false);
    }
  }, [answerQueue, bankId, flushAnnotations, isReviewMode, router]);

  const handleEndBlock = useCallback(async (forceSubmit = false) => {
    if (isReviewMode) {
      try {
        await flushAnnotations();
        router.push(bankId > 0 ? `/bank/${bankId}/sessions` : '/dashboard');
      } catch (error) {
        setPersistenceError(error instanceof Error ? error.message : 'Unable to save annotations before leaving review.');
      }
      return;
    }

    if (!forceSubmit && !window.confirm('End this block? Unanswered questions will be finalized.')) {
      return;
    }

    setIsSubmitting(true);
    setPersistenceError(null);
    try {
      await flushAnnotations();
      await answerQueue.drain();
      await Promise.all(Object.values(flagSaveChains.current));
      await completeExamSessionDirect(sessionId);
      router.push(bankId > 0 ? `/bank/${bankId}/sessions` : '/dashboard');
    } catch (error) {
      if (forceSubmit) autoSubmitStartedRef.current = false;
      setPersistenceError(error instanceof Error ? error.message : 'Unable to complete the block.');
      setIsSubmitting(false);
    }
  }, [answerQueue, bankId, flushAnnotations, isReviewMode, router, sessionId]);

  useEffect(() => {
    if (isReviewMode) return;

    const tick = () => {
      const now = authoritativeNow(serverClockOffsetMsRef.current);
      if (isCountdownSession && deadlineAtMsRef.current != null) {
        const remaining = Math.max(0, Math.ceil((deadlineAtMsRef.current - now) / 1000));
        setElapsedSeconds(remaining);
        if (remaining <= 0 && !isSubmitting && !autoSubmitStartedRef.current) {
          autoSubmitStartedRef.current = true;
          void handleEndBlock(true);
        }
        return;
      }

      if (startedAtMsRef.current != null) {
        setElapsedSeconds(Math.max(0, Math.floor((now - startedAtMsRef.current) / 1000)));
      } else {
        setElapsedSeconds(Math.max(0, Math.floor((Date.now() - fallbackClockStartedAtRef.current) / 1000)));
      }
    };

    tick();
    const timerId = window.setInterval(tick, 1000);
    return () => window.clearInterval(timerId);
  }, [handleEndBlock, isCountdownSession, isReviewMode, isSubmitting]);

  useExamKeyboardShortcuts({
    question: currentQ,
    isSubmitting,
    isTimedMode: isFeedbackLockedMode,
    onNext: () => void handleNext(),
    onPrev: () => void handlePrev(),
    onToggleFlag: toggleFlag,
    onSelectOption: selectOption,
    onSubmitAnswer: (questionId) => {
      void submitAnswer(questionId);
    },
  });

  const answeredCount = useMemo(
    () => questionIds.filter((questionId) => answers[questionId]).length,
    [answers, questionIds],
  );

  const marks = useMemo(
    () => questionIds.filter((questionId) => answers[questionId]?.isCorrect === true).length,
    [answers, questionIds],
  );

  useEffect(() => {
    if (!currentQ || !isReviewMode) return;
    if (feedbackByQuestionId[currentQ.id] || reviewFeedbackFetchingIds.current.has(currentQ.id)) return;

    reviewFeedbackFetchingIds.current.add(currentQ.id);
    getCompletedExamReviewFeedbackDirect(sessionId, currentQ.id)
      .then((feedback) => {
        setFeedbackByQuestionId((previous) => ({ ...previous, [currentQ.id]: feedback }));
        setAnswers((previous) => {
          const answer = previous[currentQ.id];
          if (!answer) return previous;
          return {
            ...previous,
            [currentQ.id]: {
              ...answer,
              isCorrect: feedback.isCorrect,
              correctOptionId: feedback.correctOptionId,
            },
          };
        });
      })
      .catch((error) => {
        setPersistenceError(error instanceof Error ? error.message : 'Unable to load review feedback.');
      })
      .finally(() => reviewFeedbackFetchingIds.current.delete(currentQ.id));
  }, [currentQ, feedbackByQuestionId, isReviewMode, sessionId]);

  useEffect(() => {
    if (!currentQ || isReviewMode || !capabilities.canSeeFeedbackBeforeCompletion) return;
    const answer = answers[currentQ.id];
    if (!answer?.selectedOptionId || feedbackByQuestionId[currentQ.id]) return;

    const applyTraining = (training: ExamTrainingFeedback) => {
      const feedback = feedbackFromTraining(training, answer.selectedOptionId as number);
      setFeedbackByQuestionId((previous) => ({ ...previous, [currentQ.id]: feedback }));
      setAnswers((previous) => {
        const current = previous[currentQ.id];
        if (!current) return previous;
        return {
          ...previous,
          [currentQ.id]: {
            ...current,
            isCorrect: feedback.isCorrect,
            correctOptionId: feedback.correctOptionId,
          },
        };
      });
    };

    const prefetched = trainingFeedbackByQuestionId[currentQ.id];
    if (prefetched) {
      applyTraining(prefetched);
      return;
    }

    void ensureTrainingFeedback(currentQ.id)
      .then(applyTraining)
      .catch((error) => {
        setPersistenceError(error instanceof Error ? error.message : 'Unable to load answer feedback.');
      });
  }, [answers, capabilities.canSeeFeedbackBeforeCompletion, currentQ, ensureTrainingFeedback, feedbackByQuestionId, isReviewMode, trainingFeedbackByQuestionId]);

  if (isBootstrapping) {
    return (
      <div className="flex h-dvh items-center justify-center overflow-hidden bg-[#282828] text-[#d9dce0]">
        <p className="animate-pulse text-[12px] font-medium">{reviewMode ? 'Loading review...' : 'Loading question...'}</p>
      </div>
    );
  }

  if (!session || questionIds.length === 0) {
    return (
      <div className="flex h-dvh items-center justify-center overflow-hidden bg-[#282828] text-[#ff7a86]">
        <p className="text-[12px] font-medium">{persistenceError || answerQueue.error || 'No questions matched this session.'}</p>
      </div>
    );
  }

  if (!currentQ) {
    return (
      <div className="flex h-dvh items-center justify-center overflow-hidden bg-[#282828] text-[#d9dce0]">
        <p className="animate-pulse text-[12px] font-medium">
          {loadingQuestionIndex == null ? 'Preparing question...' : `Preparing question ${loadingQuestionIndex + 1}...`}
        </p>
      </div>
    );
  }

  const currentFeedback = feedbackByQuestionId[currentQ.id];
  const mediaUrl = process.env.NEXT_PUBLIC_R2_MEDIA_URL || 'offline_media';
  const updatedExplanation = rewriteExamMediaHtml(currentFeedback?.explanationHtml || '', mediaUrl);
  const explanationPanels = extractExplanationPanels(updatedExplanation, isCurrentConceptBookmarked);
  const currentAnswer = answers[currentQ.id];
  const isAnswered = isReviewMode || Boolean(currentAnswer);
  const selectedOptionId = currentAnswer?.selectedOptionId ?? pendingSelections[currentQ.id] ?? null;
  const correctOptionId = currentFeedback?.correctOptionId ?? currentAnswer?.correctOptionId ?? null;
  const optionPercentages = currentFeedback?.optionPercentages || {};
  const currentHtml = prepareQuestionStemHtml(currentQ.text_html || '', mediaUrl);
  const conceptHtml = explanationPanels.conceptHtml
    ? rewriteExamMediaHtml(explanationPanels.conceptHtml, mediaUrl)
    : null;
  const visiblePersistenceError = persistenceError || answerQueue.error || annotationError;
  const isCurrentAnswerSaving =
    answerQueue.savingQuestionIds.has(currentQ.id) || revealingQuestionIds.has(currentQ.id);

  const handleExplanationClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const bookmarkButton = target.closest('[data-concept-bookmark]');
    const deepDiveButton = target.closest('[data-concept-deep-dive]');

    if (bookmarkButton) {
      event.preventDefault();
      void toggleConceptBookmark(conceptHtml);
      return;
    }
    if (deepDiveButton) event.preventDefault();
  };

  return (
    <div ref={examRootRef} className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[#282828] text-white">
      <ExamHeader
        currentIndex={currentIndex}
        elapsedSeconds={elapsedSeconds}
        isFlagged={flaggedQuestionIds.has(currentQ.id)}
        isReviewMode={isReviewMode}
        questionCount={questionIds.length}
        showClues={showClues}
        annotationTool={annotationTool}
        annotationLoading={annotationLoading}
        annotationSaving={annotationSaving}
        canUndoAnnotation={canUndoAnnotation}
        canRedoAnnotation={canRedoAnnotation}
        isFullscreen={isFullscreen}
        onSuspend={() => void handleSuspend()}
        onEndBlock={() => void handleEndBlock()}
        onNext={() => void handleNext()}
        onPrev={() => void handlePrev()}
        onToggleClues={() => setShowClues((value) => !value)}
        onToggleFlag={() => toggleFlag(currentQ.id)}
        onAnnotationToolChange={setAnnotationTool}
        onUndoAnnotation={undoAnnotation}
        onRedoAnnotation={redoAnnotation}
        onClearAnnotations={() => void handleClearAnnotations()}
        onToggleFullscreen={() => void toggleFullscreen()}
      />

      {visiblePersistenceError ? (
        <div className="mx-auto mt-2 w-[calc(100%-2rem)] max-w-[1240px] shrink-0 rounded-[4px] border border-[#95413d] bg-[#3a2d2c] px-3 py-2 text-[12px] text-[#ffd4ce]">
          {visiblePersistenceError}
        </div>
      ) : null}

      <div
        ref={mainScrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
      >
        <main className="mx-auto grid w-full max-w-[1240px] gap-6 px-4 pb-12 pt-3 lg:grid-cols-[minmax(0,1fr)_476px]">
          <div className="min-w-0">
            <WindowedExamQuestionPane
              question={currentQ}
              currentIndex={currentIndex}
              questionCount={questionIds.length}
              questionHtml={currentHtml}
              explanationHtml={explanationPanels.contentHtml}
              hasFeedback={Boolean(currentFeedback)}
              showClues={showClues}
              isAnswered={isAnswered}
              isReviewMode={isReviewMode}
              isTimedMode={isFeedbackLockedMode}
              selectedOptionId={selectedOptionId}
              struckOutOptionIds={struckOutOptionIds}
              submittedAnswer={currentAnswer}
              correctOptionId={correctOptionId}
              optionPercentages={optionPercentages}
              isSaving={isCurrentAnswerSaving}
              isSaveConfirmed={answerQueue.confirmedQuestionIds.has(currentQ.id)}
              isSubmitting={isSubmitting}
              annotationTool={annotationTool}
              annotationRecords={annotationRecords}
              onAppendAnnotationStroke={appendAnnotationStroke}
              onEraseAnnotationStroke={eraseAnnotationStroke}
              onSelectOption={selectOption}
              onToggleStrikeOut={toggleStrikeOut}
              onSubmitAnswer={() => void submitAnswer(currentQ.id)}
              onNext={() => void handleNext()}
              onExplanationClick={handleExplanationClick}
            />
          </div>

          <div
            ref={sidebarRef}
            className="hidden self-start lg:sticky lg:block"
            style={{ top: sidebarStickyTop }}
          >
            <WindowedExamSidebarWidgets
              answers={answers}
              answeredCount={answeredCount}
              bankId={bankId}
              currentIndex={currentIndex}
              isTimedMode={isFeedbackLockedMode}
              marks={marks}
              question={currentQ}
              questionIds={questionIds}
              sidebarHtml={isAnswered && !isFeedbackLockedMode ? explanationPanels.sidebarHtml : null}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

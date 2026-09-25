'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExamHeader } from '@/components/exam/ExamHeader';
import { WindowedExamQuestionPane } from '@/components/exam/WindowedExamQuestionPane';
import { WindowedExamSidebarWidgets } from '@/components/exam/WindowedExamSidebarWidgets';
import { useExamAnswerWriteQueue } from '@/components/exam/useExamAnswerWriteQueue';
import { useExamConceptBookmark } from '@/components/exam/useExamConceptBookmark';
import { useExamFlagPersistence } from '@/components/exam/useExamFlagPersistence';
import { useExamKeyboardShortcuts } from '@/components/exam/useExamKeyboardShortcuts';
import { useExamQuestionTimer } from '@/components/exam/useExamQuestionTimer';
import { useExamSessionLifecycle } from '@/components/exam/useExamSessionLifecycle';
import { useExamTrainingSubmission } from '@/components/exam/useExamTrainingSubmission';
import { useQuestionAnnotations } from '@/components/exam/useQuestionAnnotations';
import { useWindowedExamSession } from '@/components/exam/useWindowedExamSession';
import { getCompletedExamReviewFeedbackDirect } from '@/lib/exam-client-api';
import type { AnnotationTool } from '@/lib/exam-annotations';
import { PUBLIC_R2_MEDIA_URL, prepareQuestionStemHtml, rewriteExamMediaHtml } from '@/lib/exam-html';
import { examModeCapabilities } from '@/lib/exam-mode-capabilities';
import { extractExplanationPanels } from '@/lib/explanation-panels';
import type {
  ExamBootstrap,
  ExamClientAnswer,
  ExamClientOption,
  ExamQuestionFeedback,
} from '@/types/exam';

interface WindowedExamPageClientProps {
  sessionId: string;
  reviewMode?: boolean;
}

type ClockConfig = {
  startedAtMs: number | null;
  deadlineAtMs: number | null;
  serverClockOffsetMs: number;
};

export function WindowedExamPageClient({
  sessionId,
  reviewMode = false,
}: WindowedExamPageClientProps) {
  const examRootRef = useRef<HTMLDivElement>(null);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const timerSeededSessionRef = useRef<string | null>(null);
  const bootstrapAnswersRef = useRef<Record<number, ExamClientAnswer>>({});
  const reviewFeedbackFetchingIds = useRef(new Set<number>());
  const acceptedSubmissionIdsRef = useRef(new Set<number>());

  const [answers, setAnswers] = useState<Record<number, ExamClientAnswer>>({});
  const [pendingSelections, setPendingSelections] = useState<Record<number, number | null>>({});
  const [struckOutOptionIds, setStruckOutOptionIds] = useState<Set<number>>(new Set());
  const [showClues, setShowClues] = useState(false);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [feedbackByQuestionId, setFeedbackByQuestionId] = useState<Record<number, ExamQuestionFeedback>>({});
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sidebarStickyTop, setSidebarStickyTop] = useState(0);
  const [clockConfig, setClockConfig] = useState<ClockConfig>({
    startedAtMs: null,
    deadlineAtMs: null,
    serverClockOffsetMs: 0,
  });

  const {
    flaggedQuestionIds,
    savingQuestionIds: savingFlagQuestionIds,
    failedQuestionIds: failedFlagQuestionIds,
    error: flagPersistenceError,
    hydrate: hydrateFlags,
    toggle: persistFlagToggle,
    retryPending: retryFlagPending,
    drain: drainFlags,
  } = useExamFlagPersistence({ sessionId });

  const applyBootstrapState = useCallback((bootstrap: ExamBootstrap) => {
    setAnswers(bootstrap.answers);
    bootstrapAnswersRef.current = bootstrap.answers;
    hydrateFlags(bootstrap.flaggedQuestionIds);
    acceptedSubmissionIdsRef.current.clear();

    const serverNowMs = bootstrap.serverNow ? Date.parse(bootstrap.serverNow) : Number.NaN;
    const serverClockOffsetMs = Number.isFinite(serverNowMs)
      ? serverNowMs - Date.now()
      : 0;
    const rawStartedAtMs = bootstrap.session.started_at
      ? Date.parse(bootstrap.session.started_at)
      : Number.NaN;
    const rawDeadlineAtMs = bootstrap.session.deadline_at
      ? Date.parse(bootstrap.session.deadline_at)
      : Number.NaN;

    setClockConfig({
      startedAtMs: Number.isFinite(rawStartedAtMs) ? rawStartedAtMs : null,
      deadlineAtMs: Number.isFinite(rawDeadlineAtMs) ? rawDeadlineAtMs : null,
      serverClockOffsetMs,
    });
  }, [hydrateFlags]);

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
    updateStroke: updateAnnotationStroke,
    undo: undoAnnotation,
    redo: redoAnnotation,
    clearAll: clearAllAnnotations,
    flush: flushAnnotations,
  } = useQuestionAnnotations(currentQ?.id || null, sessionId);

  const isReviewMode = reviewMode && session?.is_completed === true;
  const sessionType = session?.session_type ?? 'standard';
  const capabilities = examModeCapabilities(sessionType);
  const isFeedbackLockedMode = !isReviewMode && !capabilities.canSeeFeedbackBeforeCompletion;
  const isCountdownSession =
    !isReviewMode && (sessionType === 'timed' || sessionType === 'fixed_timed');
  const bankId = Number(session?.question_bank_id || 0);

  const {
    isSubmitting,
    closingRef,
    error: lifecycleError,
    leavePromptOpen,
    confirmLeave,
    cancelLeave,
    handleSuspend,
    handleEndBlock,
  } = useExamSessionLifecycle({
    sessionId,
    bankId,
    isReviewMode,
    isSessionReady: Boolean(session),
    isCountdownSession,
    deadlineAtMs: clockConfig.deadlineAtMs,
    serverClockOffsetMs: clockConfig.serverClockOffsetMs,
    flushAnnotations,
    drainAnswers: answerQueue.drain,
    drainFlags,
    canBestEffortSuspend:
      answerQueue.savingQuestionIds.size === 0 &&
      answerQueue.failedQuestionIds.size === 0 &&
      savingFlagQuestionIds.size === 0 &&
      failedFlagQuestionIds.size === 0 &&
      !annotationSaving,
  });

  const trainingWarmQuestionIds = capabilities.canPrefetchFeedback && !isReviewMode
    ? questionIds
        .slice(currentIndex, currentIndex + 3)
        .filter((questionId) => Boolean(getQuestionById(questionId)))
    : [];

  const {
    revealingQuestionIds,
    submitAnswer,
    retrySave,
    retryFeedback,
  } = useExamTrainingSubmission({
    sessionId,
    enabled: capabilities.canPrefetchFeedback && !isReviewMode,
    warmQuestionIds: trainingWarmQuestionIds,
    currentQuestionId: currentQ?.id || null,
    isReviewMode,
    isFeedbackLockedMode,
    isSubmitting,
    closingRef,
    acceptedSubmissionIdsRef,
    answers,
    pendingSelections,
    feedbackByQuestionId,
    answerQueue,
    getQuestionById,
    elapsedForQuestion: questionTimer.elapsedForQuestion,
    queuePrefetch,
    setAnswers,
    setFeedbackByQuestionId,
    setPersistenceError,
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
      setSidebarStickyTop(Math.min(0, scrollContainer.clientHeight - sidebar.scrollHeight - 12));
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
    if (isReviewMode || isSubmitting || closingRef.current) return;
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
  }, [answerQueue, answers, capabilities.canChangeAnswerBeforeCompletion, closingRef, isFeedbackLockedMode, isReviewMode, isSubmitting, questionTimer]);

  const toggleFlag = useCallback((questionId: number) => {
    if (isSubmitting || closingRef.current) return;
    persistFlagToggle(questionId);
  }, [closingRef, isSubmitting, persistFlagToggle]);

  const toggleStrikeOut = useCallback((optionId: number) => {
    if (isReviewMode || isSubmitting || closingRef.current) return;
    setStruckOutOptionIds((previous) => {
      const next = new Set(previous);
      if (next.has(optionId)) next.delete(optionId);
      else next.add(optionId);
      return next;
    });
  }, [closingRef, isReviewMode, isSubmitting]);

  const handleNext = useCallback(() => {
    const backgroundSave = flushAnnotations();
    goNext();
    void backgroundSave.catch((error) => {
      setPersistenceError(error instanceof Error ? error.message : 'Unable to save annotations.');
    });
  }, [flushAnnotations, goNext]);

  const handlePrev = useCallback(() => {
    const backgroundSave = flushAnnotations();
    goPrev();
    void backgroundSave.catch((error) => {
      setPersistenceError(error instanceof Error ? error.message : 'Unable to save annotations.');
    });
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

  useExamKeyboardShortcuts({
    question: currentQ,
    isSubmitting,
    isTimedMode: isFeedbackLockedMode,
    onNext: () => void handleNext(),
    onPrev: () => void handlePrev(),
    onToggleFlag: toggleFlag,
    onSelectOption: selectOption,
    onSubmitAnswer: submitAnswer,
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
        <p className="text-[12px] font-medium">{persistenceError || lifecycleError || answerQueue.error || flagPersistenceError || 'No questions matched this session.'}</p>
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
  const mediaUrl = PUBLIC_R2_MEDIA_URL;
  const updatedExplanation = rewriteExamMediaHtml(currentFeedback?.explanationHtml || '', mediaUrl);
  const explanationPanels = extractExplanationPanels(updatedExplanation, isCurrentConceptBookmarked);
  const currentAnswer = answers[currentQ.id];
  const isAnswered = isReviewMode || Boolean(currentAnswer);
  const selectedOptionId = currentAnswer?.selectedOptionId ?? pendingSelections[currentQ.id] ?? null;
  const correctOptionId = currentFeedback?.correctOptionId ?? currentAnswer?.correctOptionId ?? null;
  const optionPercentages = currentFeedback?.optionPercentages || {};
  const currentHtml = prepareQuestionStemHtml(currentQ.text_html || '', mediaUrl);
  const currentDisplayQuestion = {
    ...currentQ,
    text_html: currentHtml,
    options: currentQ.options.map((option) => ({
      ...option,
      text_html: rewriteExamMediaHtml(option.text_html || '', mediaUrl),
    })),
  };
  const conceptHtml = explanationPanels.conceptHtml
    ? rewriteExamMediaHtml(explanationPanels.conceptHtml, mediaUrl)
    : null;
  const visiblePersistenceError =
    persistenceError || lifecycleError || answerQueue.error || flagPersistenceError || annotationError;
  const isCurrentAnswerSaving =
    answerQueue.savingQuestionIds.has(currentQ.id) || revealingQuestionIds.has(currentQ.id);
  const canRetryCurrentSave = answerQueue.failedQuestionIds.has(currentQ.id);
  const canRetryCurrentFlag = failedFlagQuestionIds.has(currentQ.id);

  const handleExplanationClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const bookmarkButton = target.closest('[data-concept-bookmark]');

    if (bookmarkButton) {
      event.preventDefault();
      void toggleConceptBookmark(conceptHtml);
    }
  };

  return (
    <div ref={examRootRef} className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[#282828] text-white">
      <ExamHeader
        currentIndex={currentIndex}
        clockStartedAtMs={clockConfig.startedAtMs}
        clockDeadlineAtMs={clockConfig.deadlineAtMs}
        serverClockOffsetMs={clockConfig.serverClockOffsetMs}
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
        onNext={handleNext}
        onPrev={handlePrev}
        onToggleClues={() => setShowClues((value) => !value)}
        onToggleFlag={() => toggleFlag(currentQ.id)}
        onAnnotationToolChange={setAnnotationTool}
        onUndoAnnotation={undoAnnotation}
        onRedoAnnotation={redoAnnotation}
        onClearAnnotations={() => void handleClearAnnotations()}
        onToggleFullscreen={() => void toggleFullscreen()}
      />

      {leavePromptOpen ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="suspend-leave-title"
        >
          <div className="w-full max-w-[430px] rounded-[8px] border border-[#596168] bg-[#2f353a] p-5 shadow-2xl">
            <h2 id="suspend-leave-title" className="text-[16px] font-semibold text-white">
              Suspend this block before leaving?
            </h2>
            <p className="mt-2 text-[12px] leading-5 text-[#c5cbd0]">
              Your saved answers and flags will be checkpointed so you can resume this block later.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelLeave}
                disabled={isSubmitting}
                className="rounded-[4px] border border-[#687179] px-4 py-2 text-[12px] font-medium text-[#e2e6e9] hover:bg-[#3a4248] disabled:opacity-45"
              >
                No, stay
              </button>
              <button
                type="button"
                onClick={() => void confirmLeave()}
                disabled={isSubmitting}
                className="rounded-[4px] bg-[#d5e4ff] px-4 py-2 text-[12px] font-semibold text-[#102148] hover:bg-[#e2ecff] disabled:opacity-45"
              >
                Yes, suspend & leave
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {visiblePersistenceError ? (
        <div className="mx-auto mt-2 flex w-[calc(100%-2rem)] max-w-[1240px] shrink-0 items-center justify-between gap-3 rounded-[4px] border border-[#95413d] bg-[#3a2d2c] px-3 py-2 text-[12px] text-[#ffd4ce]">
          <span>{visiblePersistenceError}</span>
          {canRetryCurrentFlag ? (
            <button
              type="button"
              onClick={() => void retryFlagPending(currentQ.id).catch(() => undefined)}
              disabled={isSubmitting}
              className="shrink-0 rounded-[3px] border border-[#b66b65] px-2 py-1 text-[#ffe5e1] hover:border-[#e0958e] disabled:opacity-45"
            >
              Retry flag save
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        ref={mainScrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
      >
        <main className="mx-auto grid w-full max-w-[1240px] gap-6 px-3 pb-[calc(96px+env(safe-area-inset-bottom))] pt-4 md:px-4 md:pb-12 md:pt-3 lg:grid-cols-[minmax(0,1fr)_476px]">
          <div className="min-w-0">
            <WindowedExamQuestionPane
              question={currentDisplayQuestion}
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
              canRetrySave={canRetryCurrentSave}
              isSubmitting={isSubmitting}
              annotationTool={annotationTool}
              annotationRecords={annotationRecords}
              onAppendAnnotationStroke={appendAnnotationStroke}
              onEraseAnnotationStroke={eraseAnnotationStroke}
              onUpdateAnnotationStroke={updateAnnotationStroke}
              onSelectOption={selectOption}
              onToggleStrikeOut={toggleStrikeOut}
              onSubmitAnswer={() => submitAnswer(currentQ.id)}
              onRetrySave={() => retrySave(currentQ.id)}
              onRetryFeedback={() => retryFeedback(currentQ.id)}
              onPrev={handlePrev}
              onNext={handleNext}
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
              flaggedQuestionIds={flaggedQuestionIds}
              bankId={bankId}
              currentIndex={currentIndex}
              isTimedMode={isFeedbackLockedMode}
              marks={marks}
              question={currentDisplayQuestion}
              questionIds={questionIds}
              sidebarHtml={isAnswered && !isFeedbackLockedMode ? explanationPanels.sidebarHtml : null}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
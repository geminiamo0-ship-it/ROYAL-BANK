'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ExamHeader } from '@/components/exam/ExamHeader';
import { WindowedExamQuestionPane } from '@/components/exam/WindowedExamQuestionPane';
import { WindowedExamSidebarWidgets } from '@/components/exam/WindowedExamSidebarWidgets';
import { useExamConceptBookmark } from '@/components/exam/useExamConceptBookmark';
import { useExamKeyboardShortcuts } from '@/components/exam/useExamKeyboardShortcuts';
import { useWindowedExamSession } from '@/components/exam/useWindowedExamSession';
import {
  completeExamSessionDirect,
  getCompletedExamReviewFeedbackDirect,
  getExamQuestionFeedbackDirect,
  setQuestionFlagDirect,
  submitExamAnswerDirect,
  submitExamAnswerWithFeedbackDirect,
} from '@/lib/exam-client-api';
import { prepareQuestionStemHtml, rewriteExamMediaHtml } from '@/lib/exam-html';
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

export function WindowedExamPageClient({
  sessionId,
  reviewMode = false,
}: WindowedExamPageClientProps) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<number, ExamClientAnswer>>({});
  const [pendingSelections, setPendingSelections] = useState<Record<number, number | null>>({});
  const [flaggedQuestionIds, setFlaggedQuestionIds] = useState<Set<number>>(new Set());
  const [struckOutOptionIds, setStruckOutOptionIds] = useState<Set<number>>(new Set());
  const [showClues, setShowClues] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [savingQuestionIds, setSavingQuestionIds] = useState<Set<number>>(new Set());
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedbackByQuestionId, setFeedbackByQuestionId] = useState<Record<number, ExamQuestionFeedback>>({});

  const answerSaveChains = useRef<Record<number, Promise<void>>>({});
  const flagSaveChains = useRef<Record<number, Promise<void>>>({});
  const feedbackFetchingIds = useRef(new Set<number>());
  const persistedSelectionRef = useRef<Record<number, number | null>>({});

  const applyBootstrapState = useCallback((bootstrap: ExamBootstrap) => {
    setAnswers(bootstrap.answers);
    setFlaggedQuestionIds(new Set(bootstrap.flaggedQuestionIds));
    persistedSelectionRef.current = Object.fromEntries(
      Object.values(bootstrap.answers).map((answer) => [answer.questionId, answer.selectedOptionId]),
    );
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

  const isReviewMode = reviewMode && session?.is_completed === true;
  const sessionType = String(session?.session_type || 'standard');
  const isTimedSession = sessionType === 'timed' || sessionType === 'fixed_timed';
  const isTimedMode = isTimedSession && !isReviewMode;
  const bankId = Number(session?.question_bank_id || 0);
  const timeLimitSeconds = Number(session?.time_limit_minutes || 0) * 60;
  const {
    isBookmarked: isCurrentConceptBookmarked,
    toggleBookmark: toggleConceptBookmark,
  } = useExamConceptBookmark(currentQ);

  const queueTimedAnswerSave = useCallback((answer: ExamClientAnswer) => {
    if (answer.selectedOptionId == null) return;
    const questionId = answer.questionId;
    const previous = answerSaveChains.current[questionId] || Promise.resolve();

    const next = previous
      .catch(() => undefined)
      .then(async () => {
        await submitExamAnswerDirect({
          sessionId,
          questionId,
          selectedOptionId: answer.selectedOptionId as number,
          timeSpentSeconds: answer.timeSpentSeconds,
        });
        persistedSelectionRef.current[questionId] = answer.selectedOptionId;
        setPersistenceError(null);
      })
      .catch((error) => {
        setPersistenceError(error instanceof Error ? error.message : 'Unable to save the timed answer.');
      });

    answerSaveChains.current[questionId] = next;
  }, [sessionId]);

  const selectOption = useCallback((questionId: number, option: ExamClientOption) => {
    if (isReviewMode) return;
    if (!isTimedMode && answers[questionId]) return;

    setPendingSelections((previous) => ({ ...previous, [questionId]: option.id }));
    if (!isTimedMode) return;

    const answer: ExamClientAnswer = {
      questionId,
      selectedOptionId: option.id,
      isCorrect: null,
      correctOptionId: null,
      timeSpentSeconds: elapsedSeconds,
    };

    setAnswers((previous) => ({ ...previous, [questionId]: answer }));
    queueTimedAnswerSave(answer);
  }, [answers, elapsedSeconds, isReviewMode, isTimedMode, queueTimedAnswerSave]);

  const submitAnswer = useCallback(async (questionId: number) => {
    if (isReviewMode || isTimedMode || answers[questionId] || savingQuestionIds.has(questionId)) return;

    const selectedOptionId = pendingSelections[questionId];
    if (!selectedOptionId) return;

    const question = getQuestionById(questionId);
    const option = question?.options?.find((item) => item.id === selectedOptionId);
    if (!option) return;

    setSavingQuestionIds((previous) => new Set(previous).add(questionId));
    setPersistenceError(null);

    try {
      const { answer: persistedAnswer, feedback } = await submitExamAnswerWithFeedbackDirect({
        sessionId,
        questionId,
        selectedOptionId: option.id,
        timeSpentSeconds: elapsedSeconds,
      });

      persistedSelectionRef.current[questionId] = option.id;
      setAnswers((previous) => ({ ...previous, [questionId]: persistedAnswer }));
      setFeedbackByQuestionId((previous) => ({ ...previous, [questionId]: feedback }));
      queuePrefetch(2);
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : 'Unable to submit the answer.');
    } finally {
      setSavingQuestionIds((previous) => {
        const next = new Set(previous);
        next.delete(questionId);
        return next;
      });
    }
  }, [answers, elapsedSeconds, getQuestionById, isReviewMode, isTimedMode, pendingSelections, queuePrefetch, savingQuestionIds, sessionId]);

  const toggleFlag = useCallback((questionId: number) => {
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
      .then(() => setPersistenceError(null))
      .catch((error) => {
        setPersistenceError(error instanceof Error ? error.message : 'Unable to update the question flag.');
      });

    flagSaveChains.current[questionId] = nextSave;
  }, [flaggedQuestionIds]);

  const toggleStrikeOut = useCallback((optionId: number) => {
    if (isReviewMode) return;
    setStruckOutOptionIds((previous) => {
      const next = new Set(previous);
      if (next.has(optionId)) next.delete(optionId);
      else next.add(optionId);
      return next;
    });
  }, [isReviewMode]);

  const flushTimedAnswers = useCallback(async () => {
    if (!isTimedMode || isReviewMode) return;
    await Promise.all(Object.values(answerSaveChains.current));

    for (const answer of Object.values(answers)) {
      if (answer.selectedOptionId == null) continue;
      if (persistedSelectionRef.current[answer.questionId] === answer.selectedOptionId) continue;

      await submitExamAnswerDirect({
        sessionId,
        questionId: answer.questionId,
        selectedOptionId: answer.selectedOptionId,
        timeSpentSeconds: answer.timeSpentSeconds,
      });
      persistedSelectionRef.current[answer.questionId] = answer.selectedOptionId;
    }
  }, [answers, isReviewMode, isTimedMode, sessionId]);

  const handleSuspend = useCallback(async () => {
    if (isReviewMode) {
      router.push(bankId > 0 ? `/bank/${bankId}/sessions` : '/dashboard');
      return;
    }

    if (!window.confirm('Suspend this block and return later?')) return;

    setIsSubmitting(true);
    setPersistenceError(null);
    try {
      await flushTimedAnswers();
      await Promise.all(Object.values(flagSaveChains.current));
      router.push(bankId > 0 ? `/bank/${bankId}/sessions` : '/dashboard');
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : 'Unable to suspend the block safely.');
      setIsSubmitting(false);
    }
  }, [bankId, flushTimedAnswers, isReviewMode, router]);

  const handleEndBlock = useCallback(async (forceSubmit = false) => {
    if (isReviewMode) {
      router.push(bankId > 0 ? `/bank/${bankId}/sessions` : '/dashboard');
      return;
    }

    if (!forceSubmit && !window.confirm('End this block? Unanswered timed questions will be marked incorrect.')) {
      return;
    }

    setIsSubmitting(true);
    setPersistenceError(null);
    try {
      await flushTimedAnswers();
      await Promise.all(Object.values(flagSaveChains.current));
      await completeExamSessionDirect(sessionId);
      router.push(bankId > 0 ? `/bank/${bankId}/sessions` : '/dashboard');
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : 'Unable to complete the block.');
      setIsSubmitting(false);
    }
  }, [bankId, flushTimedAnswers, isReviewMode, router, sessionId]);

  useEffect(() => {
    if (isReviewMode) return;

    const timerId = window.setInterval(() => {
      setElapsedSeconds((value) => {
        const nextValue = value + 1;
        if (
          isTimedMode &&
          timeLimitSeconds > 0 &&
          nextValue >= timeLimitSeconds &&
          !isSubmitting
        ) {
          window.clearInterval(timerId);
          void handleEndBlock(true);
        }
        return nextValue;
      });
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [handleEndBlock, isReviewMode, isSubmitting, isTimedMode, timeLimitSeconds]);

  useExamKeyboardShortcuts({
    question: currentQ,
    isSubmitting,
    isTimedMode,
    onNext: goNext,
    onPrev: goPrev,
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
    if (!currentQ || isTimedMode) return;
    if (!isReviewMode && !answers[currentQ.id]) return;
    if (feedbackByQuestionId[currentQ.id] || feedbackFetchingIds.current.has(currentQ.id)) return;

    feedbackFetchingIds.current.add(currentQ.id);
    const feedbackRequest = isReviewMode
      ? getCompletedExamReviewFeedbackDirect(sessionId, currentQ.id)
      : getExamQuestionFeedbackDirect(sessionId, currentQ.id);

    feedbackRequest
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
        setPersistenceError(null);
      })
      .catch((error) => {
        setPersistenceError(error instanceof Error ? error.message : 'Unable to load answer feedback.');
      })
      .finally(() => feedbackFetchingIds.current.delete(currentQ.id));
  }, [answers, currentQ, feedbackByQuestionId, isReviewMode, isTimedMode, sessionId]);

  if (isBootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#282828] text-[#d9dce0]">
        <p className="animate-pulse text-[12px] font-medium">{reviewMode ? 'Loading review...' : 'Loading question...'}</p>
      </div>
    );
  }

  if (!session || questionIds.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#282828] text-[#ff7a86]">
        <p className="text-[12px] font-medium">{persistenceError || 'No questions matched this session.'}</p>
      </div>
    );
  }

  if (!currentQ) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#282828] text-[#d9dce0]">
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
    <div className="min-h-screen bg-[#282828] text-white">
      <ExamHeader
        currentIndex={currentIndex}
        elapsedSeconds={
          isTimedMode && timeLimitSeconds > 0
            ? Math.max(0, timeLimitSeconds - elapsedSeconds)
            : elapsedSeconds
        }
        isFlagged={flaggedQuestionIds.has(currentQ.id)}
        isReviewMode={isReviewMode}
        questionCount={questionIds.length}
        showClues={showClues}
        onSuspend={() => void handleSuspend()}
        onEndBlock={() => void handleEndBlock()}
        onNext={goNext}
        onPrev={goPrev}
        onToggleClues={() => setShowClues((value) => !value)}
        onToggleFlag={() => toggleFlag(currentQ.id)}
      />

      {persistenceError ? (
        <div className="mx-auto mt-3 max-w-[1240px] rounded-[4px] border border-[#95413d] bg-[#3a2d2c] px-3 py-2 text-[12px] text-[#ffd4ce]">
          {persistenceError}
        </div>
      ) : null}

      <main className="mx-auto grid max-w-[1240px] gap-6 px-4 pb-12 pt-4 lg:grid-cols-[minmax(0,1fr)_476px]">
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
          isTimedMode={isTimedMode}
          selectedOptionId={selectedOptionId}
          struckOutOptionIds={struckOutOptionIds}
          submittedAnswer={currentAnswer}
          correctOptionId={correctOptionId}
          optionPercentages={optionPercentages}
          isSaving={savingQuestionIds.has(currentQ.id)}
          isSubmitting={isSubmitting}
          onSelectOption={selectOption}
          onToggleStrikeOut={toggleStrikeOut}
          onSubmitAnswer={() => void submitAnswer(currentQ.id)}
          onNext={goNext}
          onExplanationClick={handleExplanationClick}
        />

        <WindowedExamSidebarWidgets
          answers={answers}
          answeredCount={answeredCount}
          bankId={bankId}
          currentIndex={currentIndex}
          isTimedMode={isTimedMode}
          marks={marks}
          question={currentQ}
          questionIds={questionIds}
          sidebarHtml={isAnswered && !isTimedMode ? explanationPanels.sidebarHtml : null}
        />
      </main>
    </div>
  );
}

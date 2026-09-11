'use client';

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useExamTrainingFeedback } from '@/components/exam/useExamTrainingFeedback';
import type {
  ExamClientAnswer,
  ExamClientQuestion,
  ExamQuestionFeedback,
  ExamTrainingFeedback,
} from '@/types/exam';

type AnswerQueue = {
  failedQuestionIds: Set<number>;
  enqueue: (input: {
    questionId: number;
    selectedOptionId: number;
    timeSpentSeconds: number;
    requestId?: string;
  }) => Promise<ExamClientAnswer>;
  retryPending: (questionId: number) => Promise<ExamClientAnswer>;
};

type MutableBooleanRef = { current: boolean };
type MutableQuestionSetRef = { current: Set<number> };

function feedbackFromTraining(
  training: ExamTrainingFeedback,
  selectedOptionId: number,
): ExamQuestionFeedback {
  return {
    questionId: training.questionId,
    selectedOptionId,
    isCorrect: training.correctOptionId != null && selectedOptionId === training.correctOptionId,
    correctOptionId: training.correctOptionId,
    explanationHtml: training.explanationHtml,
    optionPercentages: training.optionPercentages,
  };
}

export function useExamTrainingSubmission(options: {
  sessionId: string;
  enabled: boolean;
  warmQuestionIds: number[];
  currentQuestionId: number | null;
  isReviewMode: boolean;
  isFeedbackLockedMode: boolean;
  isSubmitting: boolean;
  closingRef: MutableBooleanRef;
  acceptedSubmissionIdsRef: MutableQuestionSetRef;
  answers: Record<number, ExamClientAnswer>;
  pendingSelections: Record<number, number | null>;
  feedbackByQuestionId: Record<number, ExamQuestionFeedback>;
  answerQueue: AnswerQueue;
  getQuestionById: (questionId: number) => ExamClientQuestion | undefined;
  elapsedForQuestion: (questionId: number) => number;
  queuePrefetch: (count?: number) => void;
  setAnswers: Dispatch<SetStateAction<Record<number, ExamClientAnswer>>>;
  setFeedbackByQuestionId: Dispatch<SetStateAction<Record<number, ExamQuestionFeedback>>>;
  setPersistenceError: Dispatch<SetStateAction<string | null>>;
}) {
  const {
    sessionId,
    enabled,
    warmQuestionIds,
    currentQuestionId,
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
    elapsedForQuestion,
    queuePrefetch,
    setAnswers,
    setFeedbackByQuestionId,
    setPersistenceError,
  } = options;
  const [revealingQuestionIds, setRevealingQuestionIds] = useState<Set<number>>(new Set());
  const lastRecoveredAnswerRef = useRef<string | null>(null);

  const {
    feedbackByQuestionId: trainingFeedbackByQuestionId,
    ensure: ensureTrainingFeedback,
    retry: retryTrainingFeedback,
  } = useExamTrainingFeedback({ sessionId, enabled, warmQuestionIds });

  const applyTrainingFeedback = useCallback((
    questionId: number,
    selectedOptionId: number,
    timeSpentSeconds: number,
    training: ExamTrainingFeedback,
  ) => {
    const feedback = feedbackFromTraining(training, selectedOptionId);
    setAnswers((previous) => ({
      ...previous,
      [questionId]: {
        questionId,
        selectedOptionId,
        isCorrect: feedback.isCorrect,
        correctOptionId: feedback.correctOptionId,
        timeSpentSeconds,
      },
    }));
    setFeedbackByQuestionId((previous) => ({ ...previous, [questionId]: feedback }));
    queuePrefetch(3);
  }, [queuePrefetch, setAnswers, setFeedbackByQuestionId]);

  const revealTrainingFeedback = useCallback(async (
    questionId: number,
    selectedOptionId: number,
    timeSpentSeconds: number,
    retry = false,
  ) => {
    setRevealingQuestionIds((previous) => new Set(previous).add(questionId));
    setPersistenceError(null);
    try {
      const training = trainingFeedbackByQuestionId[questionId]
        || await (retry ? retryTrainingFeedback(questionId) : ensureTrainingFeedback(questionId));
      applyTrainingFeedback(questionId, selectedOptionId, timeSpentSeconds, training);
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : 'Unable to prepare answer feedback.');
    } finally {
      setRevealingQuestionIds((previous) => {
        const next = new Set(previous);
        next.delete(questionId);
        return next;
      });
    }
  }, [applyTrainingFeedback, ensureTrainingFeedback, retryTrainingFeedback, setPersistenceError, trainingFeedbackByQuestionId]);

  const submitAnswer = useCallback((questionId: number) => {
    if (isReviewMode || isFeedbackLockedMode || isSubmitting || closingRef.current) return;

    const retryingSave = answerQueue.failedQuestionIds.has(questionId);
    if (retryingSave) {
      const selectedOptionId = answers[questionId]?.selectedOptionId ?? pendingSelections[questionId];
      if (!selectedOptionId) return;

      setPersistenceError(null);
      void answerQueue.retryPending(questionId).catch(() => undefined);
      if (!feedbackByQuestionId[questionId]) {
        const timeSpentSeconds = answers[questionId]?.timeSpentSeconds ?? elapsedForQuestion(questionId);
        void revealTrainingFeedback(questionId, selectedOptionId, timeSpentSeconds, true);
      }
      return;
    }

    if (answers[questionId] || acceptedSubmissionIdsRef.current.has(questionId)) return;
    const selectedOptionId = pendingSelections[questionId];
    if (!selectedOptionId) return;

    const question = getQuestionById(questionId);
    const option = question?.options?.find((item) => item.id === selectedOptionId);
    if (!option) return;

    acceptedSubmissionIdsRef.current.add(questionId);
    const timeSpentSeconds = elapsedForQuestion(questionId);
    void answerQueue.enqueue({
      questionId,
      selectedOptionId: option.id,
      timeSpentSeconds,
    }).catch(() => undefined);
    void revealTrainingFeedback(questionId, option.id, timeSpentSeconds);
  }, [acceptedSubmissionIdsRef, answerQueue, answers, closingRef, elapsedForQuestion, feedbackByQuestionId, getQuestionById, isFeedbackLockedMode, isReviewMode, isSubmitting, pendingSelections, revealTrainingFeedback, setPersistenceError]);

  const retryFeedback = useCallback((
    questionId: number,
    selectedOptionId: number,
    timeSpentSeconds: number,
  ) => {
    void revealTrainingFeedback(questionId, selectedOptionId, timeSpentSeconds, true);
  }, [revealTrainingFeedback]);

  useEffect(() => {
    if (!currentQuestionId || isReviewMode || !enabled) return;
    const answer = answers[currentQuestionId];
    if (!answer?.selectedOptionId || feedbackByQuestionId[currentQuestionId]) return;

    const recoveryKey = `${currentQuestionId}:${answer.selectedOptionId}:${answer.timeSpentSeconds}`;
    const prefetched = trainingFeedbackByQuestionId[currentQuestionId];
    if (prefetched) {
      lastRecoveredAnswerRef.current = recoveryKey;
      applyTrainingFeedback(
        currentQuestionId,
        answer.selectedOptionId,
        answer.timeSpentSeconds,
        prefetched,
      );
      return;
    }

    if (lastRecoveredAnswerRef.current === recoveryKey) return;
    lastRecoveredAnswerRef.current = recoveryKey;
    void ensureTrainingFeedback(currentQuestionId)
      .then((training) => {
        applyTrainingFeedback(
          currentQuestionId,
          answer.selectedOptionId as number,
          answer.timeSpentSeconds,
          training,
        );
      })
      .catch((error) => {
        // Scheduled retries remain owned by useExamTrainingFeedback. This error is
        // surfaced once without creating a render-driven retry loop here.
        setPersistenceError(error instanceof Error ? error.message : 'Unable to load answer feedback.');
      });
  }, [answers, applyTrainingFeedback, currentQuestionId, enabled, ensureTrainingFeedback, feedbackByQuestionId, isReviewMode, setPersistenceError, trainingFeedbackByQuestionId]);

  return {
    revealingQuestionIds,
    submitAnswer,
    retryFeedback,
  };
}

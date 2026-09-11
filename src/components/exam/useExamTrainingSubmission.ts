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

type AcceptedOperation = {
  questionId: number;
  selectedOptionId: number;
  timeSpentSeconds: number;
};

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

function operationFromAnswer(answer: ExamClientAnswer | undefined): AcceptedOperation | null {
  if (!answer?.selectedOptionId) return null;
  return {
    questionId: answer.questionId,
    selectedOptionId: answer.selectedOptionId,
    timeSpentSeconds: answer.timeSpentSeconds,
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
  const acceptedOperationsRef = useRef(new Map<number, AcceptedOperation>());

  const {
    feedbackByQuestionId: trainingFeedbackByQuestionId,
    ensure: ensureTrainingFeedback,
    retry: retryTrainingFeedback,
  } = useExamTrainingFeedback({ sessionId, enabled, warmQuestionIds });

  useEffect(() => {
    acceptedOperationsRef.current.clear();
    lastRecoveredAnswerRef.current = null;
  }, [sessionId]);

  const getAcceptedOperation = useCallback((questionId: number): AcceptedOperation | null => {
    const pinned = acceptedOperationsRef.current.get(questionId);
    if (pinned) return pinned;
    const fromAnswer = operationFromAnswer(answers[questionId]);
    if (fromAnswer) acceptedOperationsRef.current.set(questionId, fromAnswer);
    return fromAnswer;
  }, [answers]);

  const applyTrainingFeedback = useCallback((
    operation: AcceptedOperation,
    training: ExamTrainingFeedback,
  ) => {
    const feedback = feedbackFromTraining(training, operation.selectedOptionId);
    setAnswers((previous) => ({
      ...previous,
      [operation.questionId]: {
        questionId: operation.questionId,
        selectedOptionId: operation.selectedOptionId,
        isCorrect: feedback.isCorrect,
        correctOptionId: feedback.correctOptionId,
        timeSpentSeconds: operation.timeSpentSeconds,
      },
    }));
    setFeedbackByQuestionId((previous) => ({
      ...previous,
      [operation.questionId]: feedback,
    }));
    queuePrefetch(3);
  }, [queuePrefetch, setAnswers, setFeedbackByQuestionId]);

  const revealTrainingFeedback = useCallback(async (
    operation: AcceptedOperation,
    retry = false,
  ) => {
    const { questionId } = operation;
    setRevealingQuestionIds((previous) => new Set(previous).add(questionId));
    setPersistenceError(null);
    try {
      const training = trainingFeedbackByQuestionId[questionId]
        || await (retry ? retryTrainingFeedback(questionId) : ensureTrainingFeedback(questionId));
      applyTrainingFeedback(operation, training);
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

  const retrySave = useCallback((questionId: number) => {
    if (isReviewMode || isSubmitting || closingRef.current) return;
    if (!answerQueue.failedQuestionIds.has(questionId)) return;
    setPersistenceError(null);
    // Persistence retry is deliberately mode-agnostic. Timed/fixed_timed answers
    // can recover their exact pending write without invoking any feedback path.
    void answerQueue.retryPending(questionId).catch(() => undefined);
  }, [answerQueue, closingRef, isReviewMode, isSubmitting, setPersistenceError]);

  const submitAnswer = useCallback((questionId: number) => {
    if (isReviewMode || isFeedbackLockedMode || isSubmitting || closingRef.current) return;
    if (answers[questionId] || acceptedSubmissionIdsRef.current.has(questionId)) return;

    const selectedOptionId = pendingSelections[questionId];
    if (!selectedOptionId) return;

    const question = getQuestionById(questionId);
    const option = question?.options?.find((item) => item.id === selectedOptionId);
    if (!option) return;

    const operation: AcceptedOperation = {
      questionId,
      selectedOptionId: option.id,
      timeSpentSeconds: elapsedForQuestion(questionId),
    };

    // Acceptance freezes the training selection immediately. Saving and feedback
    // both consume this same immutable operation, so later UI changes cannot make
    // the displayed correction disagree with the idempotent write being retried.
    acceptedSubmissionIdsRef.current.add(questionId);
    acceptedOperationsRef.current.set(questionId, operation);
    setAnswers((previous) => ({
      ...previous,
      [questionId]: {
        questionId,
        selectedOptionId: operation.selectedOptionId,
        isCorrect: null,
        correctOptionId: null,
        timeSpentSeconds: operation.timeSpentSeconds,
      },
    }));

    void answerQueue.enqueue(operation).catch(() => undefined);
    void revealTrainingFeedback(operation);
  }, [acceptedSubmissionIdsRef, answerQueue, answers, closingRef, elapsedForQuestion, getQuestionById, isFeedbackLockedMode, isReviewMode, isSubmitting, pendingSelections, revealTrainingFeedback, setAnswers]);

  const retryFeedback = useCallback((questionId: number) => {
    if (isReviewMode || isFeedbackLockedMode || isSubmitting || closingRef.current) return;
    if (feedbackByQuestionId[questionId]) return;
    const operation = getAcceptedOperation(questionId);
    if (!operation) return;
    void revealTrainingFeedback(operation, true);
  }, [closingRef, feedbackByQuestionId, getAcceptedOperation, isFeedbackLockedMode, isReviewMode, isSubmitting, revealTrainingFeedback]);

  useEffect(() => {
    if (!currentQuestionId || isReviewMode || !enabled) return;
    const answer = answers[currentQuestionId];
    const operation = operationFromAnswer(answer);
    if (!operation || feedbackByQuestionId[currentQuestionId]) return;
    acceptedOperationsRef.current.set(currentQuestionId, operation);

    const recoveryKey = `${operation.questionId}:${operation.selectedOptionId}:${operation.timeSpentSeconds}`;
    const prefetched = trainingFeedbackByQuestionId[currentQuestionId];
    if (prefetched) {
      lastRecoveredAnswerRef.current = recoveryKey;
      applyTrainingFeedback(operation, prefetched);
      return;
    }

    if (lastRecoveredAnswerRef.current === recoveryKey) return;
    lastRecoveredAnswerRef.current = recoveryKey;
    void ensureTrainingFeedback(currentQuestionId)
      .then((training) => applyTrainingFeedback(operation, training))
      .catch((error) => {
        // Scheduled retries remain owned by useExamTrainingFeedback. This error is
        // surfaced once without creating a render-driven retry loop here.
        setPersistenceError(error instanceof Error ? error.message : 'Unable to load answer feedback.');
      });
  }, [answers, applyTrainingFeedback, currentQuestionId, enabled, ensureTrainingFeedback, feedbackByQuestionId, isReviewMode, setPersistenceError, trainingFeedbackByQuestionId]);

  return {
    revealingQuestionIds,
    submitAnswer,
    retrySave,
    retryFeedback,
  };
}

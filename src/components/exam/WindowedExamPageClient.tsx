'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { removeSavedConcept, saveConceptVote } from '@/actions/exam';
import { ExamHeader } from '@/components/exam/ExamHeader';
import { WindowedExamQuestionPane } from '@/components/exam/WindowedExamQuestionPane';
import { WindowedExamSidebarWidgets } from '@/components/exam/WindowedExamSidebarWidgets';
import { useExamKeyboardShortcuts } from '@/components/exam/useExamKeyboardShortcuts';
import {
  completeExamSessionDirect,
  getExamQuestionFeedbackDirect,
  getExamSessionBootstrapDirect,
  getExamSessionWindowDirect,
  setQuestionFlagDirect,
  submitExamAnswerDirect,
  submitExamAnswerWithFeedbackDirect,
} from '@/lib/exam-client-api';
import { prepareQuestionStemHtml, rewriteExamMediaHtml } from '@/lib/exam-html';
import {
  getExamLaunchCache,
  mergeExamLaunchWindow,
  primeExamLaunchCache,
} from '@/lib/exam-launch-cache';
import { extractExplanationPanels } from '@/lib/explanation-panels';
import type {
  ExamBootstrap,
  ExamBootstrapSession,
  ExamClientAnswer,
  ExamClientOption,
  ExamClientQuestion,
  ExamQuestionFeedback,
} from '@/types/exam';

interface WindowedExamPageClientProps {
  sessionId: string;
}

function htmlToPlainText(html: string) {
  if (typeof document === 'undefined') {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const element = document.createElement('div');
  element.innerHTML = html;
  return element.textContent?.replace(/\s+/g, ' ').trim() || html;
}

export function WindowedExamPageClient({ sessionId }: WindowedExamPageClientProps) {
  const router = useRouter();
  const [session, setSession] = useState<ExamBootstrapSession | null>(null);
  const [questionIds, setQuestionIds] = useState<number[]>([]);
  const [questionsById, setQuestionsById] = useState<Record<number, ExamClientQuestion>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, ExamClientAnswer>>({});
  const [pendingSelections, setPendingSelections] = useState<Record<number, number | null>>({});
  const [flaggedQuestionIds, setFlaggedQuestionIds] = useState<Set<number>>(new Set());
  const [struckOutOptionIds, setStruckOutOptionIds] = useState<Set<number>>(new Set());
  const [showClues, setShowClues] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [bookmarkedConceptKeys, setBookmarkedConceptKeys] = useState<Set<string>>(new Set());
  const [pendingConceptKey, setPendingConceptKey] = useState<string | null>(null);
  const [savingQuestionIds, setSavingQuestionIds] = useState<Set<number>>(new Set());
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [loadingQuestionIndex, setLoadingQuestionIndex] = useState<number | null>(null);
  const [feedbackByQuestionId, setFeedbackByQuestionId] = useState<Record<number, ExamQuestionFeedback>>({});

  const questionIdsRef = useRef<number[]>([]);
  const questionsByIdRef = useRef<Record<number, ExamClientQuestion>>({});
  const prefetchCursorRef = useRef(0);
  const prefetchChainRef = useRef<Promise<void>>(Promise.resolve());
  const answerSaveChains = useRef<Record<number, Promise<void>>>({});
  const flagSaveChains = useRef<Record<number, Promise<void>>>({});
  const feedbackFetchingIds = useRef(new Set<number>());
  const persistedSelectionRef = useRef<Record<number, number | null>>({});

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
    setAnswers(bootstrap.answers);
    setFlaggedQuestionIds(new Set(bootstrap.flaggedQuestionIds));
    persistedSelectionRef.current = Object.fromEntries(
      Object.values(bootstrap.answers).map((answer) => [answer.questionId, answer.selectedOptionId]),
    );
    prefetchCursorRef.current = Math.min(safeIndex + 1, bootstrap.questionIds.length);
    setIsBootstrapping(false);

    queuePrefetch(2);
  }, [queuePrefetch, router]);

  useEffect(() => {
    let cancelled = false;
    const cached = getExamLaunchCache(sessionId);

    if (cached) {
      applyBootstrap(cached.bootstrap, cached.questionsById);
      return () => {
        cancelled = true;
      };
    }

    setIsBootstrapping(true);
    getExamSessionBootstrapDirect(sessionId)
      .then((bootstrap) => {
        if (cancelled) return;
        primeExamLaunchCache(bootstrap);
        applyBootstrap(bootstrap);
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Unable to load the exam session.';
        if (/not authenticated|jwt|authentication/i.test(message)) {
          router.replace('/login');
          return;
        }
        setPersistenceError(message);
        setIsBootstrapping(false);
      });

    return () => {
      cancelled = true;
    };
  }, [applyBootstrap, router, sessionId]);

  const sessionType = String(session?.session_type || 'standard');
  const isTimedMode = sessionType === 'timed' || sessionType === 'fixed_timed';
  const bankId = Number(session?.question_bank_id || 0);
  const currentQuestionId = questionIds[currentIndex];
  const currentQ = currentQuestionId ? questionsById[currentQuestionId] : undefined;
  const timeLimitSeconds = Number(session?.time_limit_minutes || 0) * 60;

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
      setPersistenceError(error instanceof Error ? error.message : 'Unable to load the question.');
    } finally {
      setLoadingQuestionIndex(null);
    }
  }, [loadWindow]);

  const goNext = useCallback(() => {
    void goToIndex(Math.min(currentIndex + 1, questionIdsRef.current.length - 1));
  }, [currentIndex, goToIndex]);

  const goPrev = useCallback(() => {
    void goToIndex(Math.max(currentIndex - 1, 0));
  }, [currentIndex, goToIndex]);

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
  }, [answers, elapsedSeconds, isTimedMode, queueTimedAnswerSave]);

  const submitAnswer = useCallback(async (questionId: number) => {
    if (isTimedMode || answers[questionId] || savingQuestionIds.has(questionId)) return;

    const selectedOptionId = pendingSelections[questionId];
    if (!selectedOptionId) return;

    const question = questionsByIdRef.current[questionId];
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
  }, [answers, elapsedSeconds, isTimedMode, pendingSelections, queuePrefetch, savingQuestionIds, sessionId]);

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
    setStruckOutOptionIds((previous) => {
      const next = new Set(previous);
      if (next.has(optionId)) next.delete(optionId);
      else next.add(optionId);
      return next;
    });
  }, []);

  const flushTimedAnswers = useCallback(async () => {
    if (!isTimedMode) return;
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
  }, [answers, isTimedMode, sessionId]);

  const handleSuspend = useCallback(async () => {
    if (!window.confirm('Suspend this block and return later?')) return;

    setIsSubmitting(true);
    setPersistenceError(null);
    try {
      await flushTimedAnswers();
      await Promise.all(Object.values(flagSaveChains.current));
      router.push(bankId > 0 ? `/bank/${bankId}/question-bank` : '/dashboard');
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : 'Unable to suspend the block safely.');
      setIsSubmitting(false);
    }
  }, [bankId, flushTimedAnswers, router]);

  const handleEndBlock = useCallback(async (forceSubmit = false) => {
    if (!forceSubmit && !window.confirm('End this block? Unanswered timed questions will be marked incorrect.')) {
      return;
    }

    setIsSubmitting(true);
    setPersistenceError(null);
    try {
      await flushTimedAnswers();
      await Promise.all(Object.values(flagSaveChains.current));
      await completeExamSessionDirect(sessionId);
      router.push(bankId > 0 ? `/bank/${bankId}/performance` : '/dashboard');
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : 'Unable to complete the block.');
      setIsSubmitting(false);
    }
  }, [bankId, flushTimedAnswers, router, sessionId]);

  useEffect(() => {
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
  }, [handleEndBlock, isSubmitting, isTimedMode, timeLimitSeconds]);

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
    if (!currentQ || isTimedMode || !answers[currentQ.id]) return;
    if (feedbackByQuestionId[currentQ.id] || feedbackFetchingIds.current.has(currentQ.id)) return;

    feedbackFetchingIds.current.add(currentQ.id);
    getExamQuestionFeedbackDirect(sessionId, currentQ.id)
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
  }, [answers, currentQ, feedbackByQuestionId, isTimedMode, sessionId]);

  if (isBootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#282828] text-[#d9dce0]">
        <p className="animate-pulse text-[12px] font-medium">Loading question...</p>
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

  const currentConceptKey = currentQ.concept_id || String(currentQ.id);
  const isCurrentConceptBookmarked = bookmarkedConceptKeys.has(currentConceptKey);
  const currentFeedback = feedbackByQuestionId[currentQ.id];
  const mediaUrl = process.env.NEXT_PUBLIC_R2_MEDIA_URL || 'offline_media';
  const updatedExplanation = rewriteExamMediaHtml(currentFeedback?.explanationHtml || '', mediaUrl);
  const explanationPanels = extractExplanationPanels(updatedExplanation, isCurrentConceptBookmarked);
  const currentAnswer = answers[currentQ.id];
  const isAnswered = Boolean(currentAnswer);
  const selectedOptionId = currentAnswer?.selectedOptionId ?? pendingSelections[currentQ.id] ?? null;
  const correctOptionId = currentFeedback?.correctOptionId ?? currentAnswer?.correctOptionId ?? null;
  const optionPercentages = currentFeedback?.optionPercentages || {};
  const currentHtml = prepareQuestionStemHtml(currentQ.text_html || '', mediaUrl);
  const conceptHtml = explanationPanels.conceptHtml
    ? rewriteExamMediaHtml(explanationPanels.conceptHtml, mediaUrl)
    : null;

  const handleConceptBookmark = async () => {
    if (!conceptHtml || pendingConceptKey) return;
    setPendingConceptKey(currentConceptKey);

    if (isCurrentConceptBookmarked) {
      setBookmarkedConceptKeys((previous) => {
        const next = new Set(previous);
        next.delete(currentConceptKey);
        return next;
      });

      try {
        await removeSavedConcept(currentQ.id);
      } catch {
        setBookmarkedConceptKeys((previous) => new Set(previous).add(currentConceptKey));
      } finally {
        setPendingConceptKey(null);
      }
      return;
    }

    setBookmarkedConceptKeys((previous) => new Set(previous).add(currentConceptKey));
    try {
      await saveConceptVote({
        questionId: currentQ.id,
        conceptText: htmlToPlainText(conceptHtml),
        isImportant: true,
      });
    } catch {
      setBookmarkedConceptKeys((previous) => {
        const next = new Set(previous);
        next.delete(currentConceptKey);
        return next;
      });
    } finally {
      setPendingConceptKey(null);
    }
  };

  const handleExplanationClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const bookmarkButton = target.closest('[data-concept-bookmark]');
    const deepDiveButton = target.closest('[data-concept-deep-dive]');

    if (bookmarkButton) {
      event.preventDefault();
      void handleConceptBookmark();
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

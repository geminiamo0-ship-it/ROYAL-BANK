'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  completeExamSession,
  getExamQuestionFeedback,
  removeSavedConcept,
  saveConceptVote,
  saveUserAnswer,
  setQuestionFlag,
} from '@/actions/exam';
import { saveUserAnswerWithFeedback } from '@/actions/exam-feedback';
import { AnswerOptionList } from '@/components/exam/AnswerOptionList';
import { ExamHeader } from '@/components/exam/ExamHeader';
import { ExamSidebarWidgets } from '@/components/exam/ExamSidebarWidgets';
import { extractExplanationPanels } from '@/lib/explanation-panels';
import type {
  ExamClientAnswer,
  ExamClientOption,
  ExamClientQuestion,
  ExamClientSession,
  ExamQuestionFeedback,
} from '@/types/exam';
import { ChevronRight } from 'lucide-react';

interface ExamPageClientProps {
  initialQuestions: ExamClientQuestion[];
  sessionId: string;
  initialAnswers?: Record<number, ExamClientAnswer>;
  initialFlaggedQuestionIds?: number[];
  session: ExamClientSession | null;
}

function htmlToPlainText(html: string) {
  if (typeof document === 'undefined') {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const element = document.createElement('div');
  element.innerHTML = html;
  return element.textContent?.replace(/\s+/g, ' ').trim() || html;
}

export function ExamPageClient({
  initialQuestions,
  sessionId,
  initialAnswers = {},
  initialFlaggedQuestionIds = [],
  session,
}: ExamPageClientProps) {
  const router = useRouter();
  const [questions] = useState<ExamClientQuestion[]>(initialQuestions);
  const sessionType = String(session?.session_type || 'standard');
  const isTimedMode = sessionType === 'timed' || sessionType === 'fixed_timed';
  const bankId = Number(session?.question_bank_id || 0);

  const firstUnansweredIndex = questions.findIndex((question) => !initialAnswers[question.id]);
  const [currentIndex, setCurrentIndex] = useState(firstUnansweredIndex >= 0 ? firstUnansweredIndex : 0);
  const [answers, setAnswers] = useState<Record<number, ExamClientAnswer>>(initialAnswers);
  const [pendingSelections, setPendingSelections] = useState<Record<number, number | null>>({});
  const [flaggedQuestionIds, setFlaggedQuestionIds] = useState<Set<number>>(
    () => new Set(initialFlaggedQuestionIds)
  );
  const [struckOutOptionIds, setStruckOutOptionIds] = useState<Set<number>>(new Set());
  const [showClues, setShowClues] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [bookmarkedConceptKeys, setBookmarkedConceptKeys] = useState<Set<string>>(new Set());
  const [pendingConceptKey, setPendingConceptKey] = useState<string | null>(null);
  const [savingQuestionIds, setSavingQuestionIds] = useState<Set<number>>(new Set());
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedbackByQuestionId, setFeedbackByQuestionId] = useState<Record<number, ExamQuestionFeedback>>({});

  const answerSaveChains = React.useRef<Record<number, Promise<void>>>({});
  const flagSaveChains = React.useRef<Record<number, Promise<void>>>({});
  const feedbackFetchingIds = React.useRef(new Set<number>());
  const persistedSelectionRef = React.useRef<Record<number, number | null>>(
    Object.fromEntries(
      Object.values(initialAnswers).map((answer) => [answer.questionId, answer.selectedOptionId])
    )
  );

  const currentQ = questions[currentIndex];
  const timeLimitSeconds = Number(session?.time_limit_minutes || 0) * 60;

  const goNext = useCallback(() => {
    setCurrentIndex((value) => Math.min(value + 1, questions.length - 1));
  }, [questions.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex((value) => Math.max(value - 1, 0));
  }, []);

  const queueTimedAnswerSave = useCallback((answer: ExamClientAnswer) => {
    const questionId = answer.questionId;
    const previous = answerSaveChains.current[questionId] || Promise.resolve();

    const next = previous
      .catch(() => undefined)
      .then(async () => {
        await saveUserAnswer({
          sessionId,
          questionId,
          selectedOptionId: answer.selectedOptionId,
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

    setPendingSelections((previous) => ({
      ...previous,
      [questionId]: option.id,
    }));

    if (!isTimedMode) return;

    const answer: ExamClientAnswer = {
      questionId,
      selectedOptionId: option.id,
      isCorrect: null,
      correctOptionId: null,
      timeSpentSeconds: elapsedSeconds,
    };

    setAnswers((previous) => ({
      ...previous,
      [questionId]: answer,
    }));
    queueTimedAnswerSave(answer);
  }, [answers, elapsedSeconds, isTimedMode, queueTimedAnswerSave]);

  const submitAnswer = useCallback(async (questionId: number) => {
    if (isTimedMode || answers[questionId] || savingQuestionIds.has(questionId)) return;

    const selectedOptionId = pendingSelections[questionId];
    if (!selectedOptionId) return;

    const question = questions.find((item) => item.id === questionId);
    const option = question?.options?.find((item) => item.id === selectedOptionId);
    if (!option) return;

    setSavingQuestionIds((previous) => new Set(previous).add(questionId));
    setPersistenceError(null);

    try {
      const { answer: persistedAnswer, feedback } = await saveUserAnswerWithFeedback({
        sessionId,
        questionId,
        selectedOptionId: option.id,
        timeSpentSeconds: elapsedSeconds,
      });

      persistedSelectionRef.current[questionId] = option.id;
      setAnswers((previous) => ({
        ...previous,
        [questionId]: persistedAnswer,
      }));
      setFeedbackByQuestionId((previous) => ({
        ...previous,
        [questionId]: feedback,
      }));
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : 'Unable to submit the answer.');
    } finally {
      setSavingQuestionIds((previous) => {
        const next = new Set(previous);
        next.delete(questionId);
        return next;
      });
    }
  }, [answers, elapsedSeconds, isTimedMode, pendingSelections, questions, savingQuestionIds, sessionId]);

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
      .then(() => setQuestionFlag(questionId, nextFlagged))
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

      await saveUserAnswer({
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
      await completeExamSession(sessionId);
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement).tagName)) return;
      if (!currentQ || isSubmitting) return;

      if (event.key === 'ArrowRight') {
        goNext();
        return;
      }
      if (event.key === 'ArrowLeft') {
        goPrev();
        return;
      }
      if (event.key.toLowerCase() === 'f') {
        toggleFlag(currentQ.id);
        return;
      }
      if (['1', '2', '3', '4', '5'].includes(event.key)) {
        const optionIndex = Number(event.key) - 1;
        const option = currentQ.options?.[optionIndex];
        if (option) selectOption(currentQ.id, option);
        return;
      }
      if (event.key === 'Enter' && !isTimedMode) {
        void submitAnswer(currentQ.id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentQ, goNext, goPrev, isSubmitting, isTimedMode, selectOption, submitAnswer, toggleFlag]);

  const answeredCount = useMemo(
    () => questions.filter((item) => answers[item.id]).length,
    [answers, questions]
  );

  const marks = useMemo(
    () => questions.filter((item) => answers[item.id]?.isCorrect === true).length,
    [answers, questions]
  );

  useEffect(() => {
    if (!currentQ || isTimedMode || !answers[currentQ.id]) return;
    if (feedbackByQuestionId[currentQ.id] || feedbackFetchingIds.current.has(currentQ.id)) return;

    feedbackFetchingIds.current.add(currentQ.id);
    getExamQuestionFeedback(sessionId, currentQ.id)
      .then((feedback) => {
        setFeedbackByQuestionId((previous) => ({
          ...previous,
          [currentQ.id]: feedback,
        }));
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
      .finally(() => {
        feedbackFetchingIds.current.delete(currentQ.id);
      });
  }, [answers, currentQ, feedbackByQuestionId, isTimedMode, sessionId]);

  const currentConceptKey = currentQ?.concept_id || (currentQ ? String(currentQ.id) : '');
  const isCurrentConceptBookmarked = currentConceptKey
    ? bookmarkedConceptKeys.has(currentConceptKey)
    : false;
  const currentFeedback = feedbackByQuestionId[currentQ?.id || 0];

  const explanationPanels = useMemo(() => {
    const rawExplanation = currentFeedback?.explanationHtml || '';
    const isAnsweredLocal = Boolean(answers[currentQ?.id || 0]);

    if (!rawExplanation && isAnsweredLocal && !isTimedMode) {
      return {
        contentHtml: '<div class="text-[#80868b] animate-pulse py-4">Fetching explanation...</div>',
        sidebarHtml: null,
        conceptHtml: null,
        conceptImageHtml: null,
      };
    }

    const mediaUrl = process.env.NEXT_PUBLIC_R2_MEDIA_URL || 'offline_media';
    const updatedExplanation = rawExplanation.replace(
      /(["'])(?:offline_media\/|https:\/\/media\.royalbank\.com\/questions\/)/gi,
      `$1${mediaUrl}/`
    );
    return extractExplanationPanels(updatedExplanation, isCurrentConceptBookmarked);
  }, [answers, currentFeedback?.explanationHtml, currentQ?.id, isCurrentConceptBookmarked, isTimedMode]);

  if (!currentQ) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#282828] text-[#ff7a86]">
        <p className="text-[12px] font-medium">No questions matched this session.</p>
      </div>
    );
  }

  const currentAnswer = answers[currentQ.id];
  const isAnswered = Boolean(currentAnswer);
  const selectedOptionId = currentAnswer?.selectedOptionId ?? pendingSelections[currentQ.id] ?? null;
  const correctOptionId = currentFeedback?.correctOptionId ?? currentAnswer?.correctOptionId ?? null;
  const optionPercentages = currentFeedback?.optionPercentages || {};
  const mediaUrl = process.env.NEXT_PUBLIC_R2_MEDIA_URL || 'offline_media';

  const currentHtml = currentQ.text_html
    ? currentQ.text_html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(
          /(["'])(?:offline_media\/|https:\/\/media\.royalbank\.com\/questions\/)/gi,
          `$1${mediaUrl}/`
        )
    : '';

  const conceptHtml = explanationPanels.conceptHtml
    ? explanationPanels.conceptHtml.replace(
        /(["'])(?:offline_media\/|https:\/\/media\.royalbank\.com\/questions\/)/gi,
        `$1${mediaUrl}/`
      )
    : null;

  const conceptKey = currentConceptKey;
  const isConceptBookmarked = isCurrentConceptBookmarked;

  const handleConceptBookmark = async () => {
    if (!conceptHtml || pendingConceptKey) return;

    setPendingConceptKey(conceptKey);

    if (isConceptBookmarked) {
      setBookmarkedConceptKeys((previous) => {
        const next = new Set(previous);
        next.delete(conceptKey);
        return next;
      });

      try {
        await removeSavedConcept(currentQ.id);
      } catch {
        setBookmarkedConceptKeys((previous) => new Set(previous).add(conceptKey));
      } finally {
        setPendingConceptKey(null);
      }
      return;
    }

    setBookmarkedConceptKeys((previous) => new Set(previous).add(conceptKey));

    try {
      await saveConceptVote({
        questionId: currentQ.id,
        conceptText: htmlToPlainText(conceptHtml),
        isImportant: true,
      });
    } catch {
      setBookmarkedConceptKeys((previous) => {
        const next = new Set(previous);
        next.delete(conceptKey);
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
        questionCount={questions.length}
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
        <section className="min-w-0">
          <div
            className={`pm-question-stem select-text text-[16px] leading-[1.55] text-white ${
              showClues ? 'pm-show-clues' : 'pm-hide-clues'
            }`}
            dangerouslySetInnerHTML={{ __html: currentHtml }}
          />

          <AnswerOptionList
            isAnswered={isAnswered}
            isTimedMode={isTimedMode}
            pendingSelectionId={selectedOptionId}
            question={currentQ}
            struckOutOptionIds={struckOutOptionIds}
            submittedAnswer={currentAnswer}
            correctOptionId={correctOptionId}
            optionPercentages={optionPercentages}
            onSelectOption={selectOption}
            onToggleStrikeOut={toggleStrikeOut}
          />

          {!isTimedMode && !isAnswered ? (
            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={() => void submitAnswer(currentQ.id)}
                disabled={!selectedOptionId || savingQuestionIds.has(currentQ.id) || isSubmitting}
                className="inline-flex h-[34px] items-center rounded-[4px] bg-[#7f1fff] px-4 text-[14px] font-medium text-white hover:bg-[#8d33ff] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {savingQuestionIds.has(currentQ.id) ? 'Submitting...' : 'Submit answer'}
              </button>
              {!selectedOptionId ? (
                <span className="text-[12px] text-[#a8aeb4]">Choose one option first.</span>
              ) : null}
            </div>
          ) : null}

          {isTimedMode ? (
            <p className="mt-3 text-[11px] text-[#a8aeb4]">
              Timed selections are saved automatically and can be changed until End Block.
            </p>
          ) : null}

          {isAnswered && !isTimedMode ? (
            <div className="space-y-6 pt-6">
              <div
                className="pm-explanation-container text-[16px] leading-[1.7] text-white"
                onClick={handleExplanationClick}
              >
                {currentQ.topic ? (
                  <h2 className="mb-5 text-[16px] font-semibold text-[#23a7ff]">{currentQ.topic}</h2>
                ) : null}
                <div dangerouslySetInnerHTML={{ __html: explanationPanels.contentHtml }} />
              </div>

              {currentIndex < questions.length - 1 ? (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={goNext}
                    className="inline-flex h-[36px] items-center gap-2 rounded-[4px] bg-[#7f1fff] px-4 text-[14px] font-medium text-white hover:bg-[#8d33ff]"
                  >
                    <span>Next question</span>
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <ExamSidebarWidgets
          answers={answers}
          answeredCount={answeredCount}
          bankId={bankId}
          currentIndex={currentIndex}
          isTimedMode={isTimedMode}
          marks={marks}
          question={currentQ}
          questions={questions}
          sidebarHtml={isAnswered && !isTimedMode ? explanationPanels.sidebarHtml : null}
        />
      </main>
    </div>
  );
}
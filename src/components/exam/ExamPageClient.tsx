'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { removeSavedConcept, saveConceptVote, saveUserAnswer, getQuestionExplanation } from '@/actions/exam';
import { AnswerOptionList } from '@/components/exam/AnswerOptionList';
import { ExamHeader } from '@/components/exam/ExamHeader';
import { ExamSidebarWidgets } from '@/components/exam/ExamSidebarWidgets';
import { extractExplanationPanels } from '@/lib/explanation-panels';
import type { UserExamAnswer } from '@/stores/examStore';
import type { Option, Question } from '@/types/database';
import { ChevronRight } from 'lucide-react';

interface ExamPageClientProps {
  initialQuestions: Question[];
  sessionId: string;
  initialAnswers?: Record<number, UserExamAnswer>;
  session: any;
}

function htmlToPlainText(html: string) {
  if (typeof document === 'undefined') {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const element = document.createElement('div');
  element.innerHTML = html;
  return element.textContent?.replace(/\s+/g, ' ').trim() || html;
}

export function ExamPageClient({ initialQuestions, sessionId, initialAnswers = {}, session }: ExamPageClientProps) {
  const router = useRouter();
  const [questions] = useState<Question[]>(initialQuestions);

  const firstUnansweredIndex = questions.findIndex(q => !initialAnswers[q.id]);
  const [currentIndex, setCurrentIndex] = useState(firstUnansweredIndex >= 0 ? firstUnansweredIndex : 0);
  
  const [answers, setAnswers] = useState<Record<number, UserExamAnswer>>(initialAnswers);
  const [pendingSelections, setPendingSelections] = useState<Record<number, number | null>>({});
  const [flaggedQuestionIds, setFlaggedQuestionIds] = useState<Set<number>>(new Set());
  const [struckOutOptionIds, setStruckOutOptionIds] = useState<Set<number>>(new Set());
  const [showClues, setShowClues] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [bookmarkedConceptKeys, setBookmarkedConceptKeys] = useState<Set<string>>(new Set());
  const [pendingConceptKey, setPendingConceptKey] = useState<string | null>(null);
  
  const [persistedAnswerKeys, setPersistedAnswerKeys] = useState<Set<string>>(() => {
    const keys = new Set<string>();
    Object.values(initialAnswers).forEach(ans => {
      keys.add(`${sessionId}:${ans.questionId}:${ans.selectedOptionId}`);
    });
    return keys;
  });

  const currentQ = questions[currentIndex];

  const goNext = useCallback(() => {
    setCurrentIndex((value) => Math.min(value + 1, questions.length - 1));
  }, [questions.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex((value) => Math.max(value - 1, 0));
  }, []);

  const selectOption = useCallback((questionId: number, option: Option) => {
    if (answers[questionId]) {
      return;
    }

    setPendingSelections((prev) => ({
      ...prev,
      [questionId]: option.id,
    }));
  }, [answers]);

  const submitAnswer = useCallback((questionId: number) => {
    setAnswers((currentAnswers) => {
      if (currentAnswers[questionId]) {
        return currentAnswers;
      }

      const selectedOptionId = pendingSelections[questionId];
      if (!selectedOptionId) {
        return currentAnswers;
      }

      const question = questions.find((item) => item.id === questionId);
      const option = question?.options?.find((item) => item.id === selectedOptionId);
      if (!option) {
        return currentAnswers;
      }

      return {
        ...currentAnswers,
        [questionId]: {
          questionId,
          selectedOptionId: option.id,
          isCorrect: option.is_correct,
          timeSpentSeconds: elapsedSeconds,
        },
      };
    });
  }, [elapsedSeconds, pendingSelections, questions]);

  const toggleFlag = useCallback((questionId: number) => {
    setFlaggedQuestionIds((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) {
        next.delete(questionId);
      } else {
        next.add(questionId);
      }
      return next;
    });
  }, []);

  const toggleStrikeOut = useCallback((optionId: number) => {
    setStruckOutOptionIds((prev) => {
      const next = new Set(prev);
      if (next.has(optionId)) {
        next.delete(optionId);
      } else {
        next.add(optionId);
      }
      return next;
    });
  }, []);

  const handleExit = useCallback(() => {
    if (window.confirm('Are you sure you want to end this test session?')) {
      router.push('/bank/1/question-bank');
    }
  }, [router]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setElapsedSeconds((value) => value + 1);
    }, 1000);

    return () => window.clearInterval(timerId);
  }, []);

  useEffect(() => {
    const pendingAnswers = Object.values(answers).filter((answer) => {
      const key = `${sessionId}:${answer.questionId}:${answer.selectedOptionId}`;
      return !persistedAnswerKeys.has(key);
    });

    if (pendingAnswers.length === 0) {
      return;
    }

    let cancelled = false;

    async function persist() {
      for (const answer of pendingAnswers) {
        const key = `${sessionId}:${answer.questionId}:${answer.selectedOptionId}`;
        try {
          await saveUserAnswer({
            sessionId,
            questionId: answer.questionId,
            selectedOptionId: answer.selectedOptionId,
            isCorrect: answer.isCorrect,
            isFlagged: flaggedQuestionIds.has(answer.questionId),
            timeSpentSeconds: answer.timeSpentSeconds,
          });

          if (!cancelled) {
            setPersistedAnswerKeys((prev) => new Set(prev).add(key));
          }
        } catch {
          // Keep the local answer visible and retry on a later interaction.
        }
      }
    }

    persist();

    return () => {
      cancelled = true;
    };
  }, [answers, flaggedQuestionIds, persistedAnswerKeys, sessionId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement).tagName)) {
        return;
      }

      if (!currentQ) {
        return;
      }

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
        if (option) {
          selectOption(currentQ.id, option);
        }
        return;
      }

      if (event.key === 'Enter') {
        submitAnswer(currentQ.id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentQ, goNext, goPrev, selectOption, submitAnswer, toggleFlag]);

  const answeredCount = useMemo(
    () => questions.slice(0, currentIndex + 1).filter((item) => answers[item.id]).length,
    [answers, currentIndex, questions]
  );

  const marks = useMemo(
    () => questions.slice(0, currentIndex + 1).filter((item) => answers[item.id]?.isCorrect).length,
    [answers, currentIndex, questions]
  );

  const currentConceptKey = currentQ?.concept_id || (currentQ ? String(currentQ.id) : '');
  const isCurrentConceptBookmarked = currentConceptKey ? bookmarkedConceptKeys.has(currentConceptKey) : false;

  const [explanations, setExplanations] = useState<Record<number, string>>({});
  const fetchingIds = React.useRef(new Set<number>());

  useEffect(() => {
    if (!currentQ) return;
    
    // EAGER PREFETCH: Fetch explanation for the current question immediately
    if (!explanations[currentQ.id] && !fetchingIds.current.has(currentQ.id)) {
      fetchingIds.current.add(currentQ.id);
      getQuestionExplanation(currentQ.id).then((html) => {
        if (html) {
          setExplanations((prev) => ({ ...prev, [currentQ.id]: html }));
        }
      }).finally(() => {
        fetchingIds.current.delete(currentQ.id);
      });
    }

    // Prefetch next question's explanation quietly
    if (currentIndex + 1 < questions.length) {
      const nextQ = questions[currentIndex + 1];
      if (!explanations[nextQ.id] && !fetchingIds.current.has(nextQ.id)) {
        fetchingIds.current.add(nextQ.id);
        getQuestionExplanation(nextQ.id).then((html) => {
          if (html) {
            setExplanations((prev) => ({ ...prev, [nextQ.id]: html }));
          }
        }).finally(() => {
          fetchingIds.current.delete(nextQ.id);
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQ?.id, currentIndex, questions.length]);

  const explanationPanels = useMemo(() => {
    const rawExplanation = explanations[currentQ?.id || 0] || '';
    const isAnsweredLocal = !!answers[currentQ?.id || 0];

    if (!rawExplanation && isAnsweredLocal) {
      return {
        contentHtml: '<div class="text-[#80868b] animate-pulse py-4">Fetching explanation...</div>',
        sidebarHtml: null,
        conceptHtml: null,
        conceptImageHtml: null,
      };
    }
    
    const mediaUrl = process.env.NEXT_PUBLIC_R2_MEDIA_URL || 'offline_media';
    const updatedExplanation = rawExplanation.replace(/(["'])(?:offline_media\/|https:\/\/media\.royalbank\.com\/questions\/)/gi, `$1${mediaUrl}/`);
    return extractExplanationPanels(updatedExplanation, isCurrentConceptBookmarked);
  }, [explanations, currentQ?.id, isCurrentConceptBookmarked, answers]);

  if (!currentQ) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#282828] text-[#ff7a86]">
        <p className="text-[12px] font-medium">No questions matched this session.</p>
      </div>
    );
  }

  const currentAnswer = answers[currentQ.id];
  const isAnswered = !!currentAnswer;
  const selectedOptionId = currentAnswer?.selectedOptionId ?? pendingSelections[currentQ.id] ?? null;
  
  const mediaUrl = process.env.NEXT_PUBLIC_R2_MEDIA_URL || 'offline_media';
  
  const currentHtml = currentQ.text_html
    ? currentQ.text_html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/(["'])(?:offline_media\/|https:\/\/media\.royalbank\.com\/questions\/)/gi, `$1${mediaUrl}/`)
    : '';
    
  const conceptHtml = explanationPanels.conceptHtml 
    ? explanationPanels.conceptHtml.replace(/(["'])(?:offline_media\/|https:\/\/media\.royalbank\.com\/questions\/)/gi, `$1${mediaUrl}/`) 
    : (currentQ.concept ? currentQ.concept.replace(/(["'])(?:offline_media\/|https:\/\/media\.royalbank\.com\/questions\/)/gi, `$1${mediaUrl}/`) : null);
    
  const conceptKey = currentConceptKey;
  const isConceptBookmarked = isCurrentConceptBookmarked;

  const handleConceptBookmark = async () => {
    if (!conceptHtml || pendingConceptKey) {
      return;
    }

    setPendingConceptKey(conceptKey);

    if (isConceptBookmarked) {
      setBookmarkedConceptKeys((prev) => {
        const next = new Set(prev);
        next.delete(conceptKey);
        return next;
      });

      try {
        await removeSavedConcept(currentQ.id);
      } catch {
        setBookmarkedConceptKeys((prev) => new Set(prev).add(conceptKey));
      } finally {
        setPendingConceptKey(null);
      }
      return;
    }

    setBookmarkedConceptKeys((prev) => new Set(prev).add(conceptKey));

    try {
      await saveConceptVote({
        questionId: currentQ.id,
        conceptText: htmlToPlainText(conceptHtml),
        isImportant: true,
      });
    } catch {
      setBookmarkedConceptKeys((prev) => {
        const next = new Set(prev);
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

    if (deepDiveButton) {
      event.preventDefault();
    }
  };

  return (
    <div className="min-h-screen bg-[#282828] text-white">
      <ExamHeader
        currentIndex={currentIndex}
        elapsedSeconds={elapsedSeconds}
        isFlagged={flaggedQuestionIds.has(currentQ.id)}
        questionCount={questions.length}
        showClues={showClues}
        onExit={handleExit}
        onNext={goNext}
        onPrev={goPrev}
        onToggleClues={() => setShowClues((value) => !value)}
        onToggleFlag={() => toggleFlag(currentQ.id)}
      />

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
            pendingSelectionId={selectedOptionId}
            question={currentQ}
            struckOutOptionIds={struckOutOptionIds}
            submittedAnswer={currentAnswer}
            onSelectOption={selectOption}
            onToggleStrikeOut={toggleStrikeOut}
          />

          {!isAnswered ? (
            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={() => submitAnswer(currentQ.id)}
                disabled={!selectedOptionId}
                className="inline-flex h-[34px] items-center rounded-[4px] bg-[#7f1fff] px-4 text-[14px] font-medium text-white hover:bg-[#8d33ff] disabled:cursor-not-allowed disabled:opacity-45"
              >
                Submit answer
              </button>
              {!selectedOptionId ? (
                <span className="text-[12px] text-[#a8aeb4]">Choose one option first.</span>
              ) : null}
            </div>
          ) : null}

          {isAnswered ? (
            <div className="space-y-6 pt-6">
              <div className="pm-explanation-container text-[16px] leading-[1.7] text-white" onClick={handleExplanationClick}>
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
          currentIndex={currentIndex}
          marks={marks}
          question={currentQ}
          questions={questions}
          sidebarHtml={isAnswered ? explanationPanels.sidebarHtml : null}
        />
      </main>
    </div>
  );
}

// force rebuild 1

'use client';

import React from 'react';
import { ChevronRight } from 'lucide-react';
import { AnswerOptionList } from '@/components/exam/AnswerOptionList';
import type {
  ExamClientAnswer,
  ExamClientOption,
  ExamClientQuestion,
} from '@/types/exam';

interface WindowedExamQuestionPaneProps {
  question: ExamClientQuestion;
  currentIndex: number;
  questionCount: number;
  questionHtml: string;
  explanationHtml: string;
  hasFeedback: boolean;
  showClues: boolean;
  isAnswered: boolean;
  isTimedMode: boolean;
  selectedOptionId: number | null;
  struckOutOptionIds: Set<number>;
  submittedAnswer?: ExamClientAnswer;
  correctOptionId: number | null;
  optionPercentages: Record<number, number>;
  isSaving: boolean;
  isSubmitting: boolean;
  onSelectOption: (questionId: number, option: ExamClientOption) => void;
  onToggleStrikeOut: (optionId: number) => void;
  onSubmitAnswer: () => void;
  onNext: () => void;
  onExplanationClick: (event: React.MouseEvent<HTMLDivElement>) => void;
}

export function WindowedExamQuestionPane({
  question,
  currentIndex,
  questionCount,
  questionHtml,
  explanationHtml,
  hasFeedback,
  showClues,
  isAnswered,
  isTimedMode,
  selectedOptionId,
  struckOutOptionIds,
  submittedAnswer,
  correctOptionId,
  optionPercentages,
  isSaving,
  isSubmitting,
  onSelectOption,
  onToggleStrikeOut,
  onSubmitAnswer,
  onNext,
  onExplanationClick,
}: WindowedExamQuestionPaneProps) {
  return (
    <section className="min-w-0">
      <div
        className={`pm-question-stem select-text text-[16px] leading-[1.55] text-white ${
          showClues ? 'pm-show-clues' : 'pm-hide-clues'
        }`}
        dangerouslySetInnerHTML={{ __html: questionHtml }}
      />

      <AnswerOptionList
        isAnswered={isAnswered}
        isTimedMode={isTimedMode}
        pendingSelectionId={selectedOptionId}
        question={question}
        struckOutOptionIds={struckOutOptionIds}
        submittedAnswer={submittedAnswer}
        correctOptionId={correctOptionId}
        optionPercentages={optionPercentages}
        onSelectOption={onSelectOption}
        onToggleStrikeOut={onToggleStrikeOut}
      />

      {!isTimedMode && !isAnswered ? (
        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={onSubmitAnswer}
            disabled={!selectedOptionId || isSaving || isSubmitting}
            className="inline-flex h-[34px] items-center rounded-[4px] bg-[#7f1fff] px-4 text-[14px] font-medium text-white hover:bg-[#8d33ff] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {isSaving ? 'Submitting...' : 'Submit answer'}
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
            onClick={onExplanationClick}
          >
            {question.topic ? (
              <h2 className="mb-5 text-[16px] font-semibold text-[#23a7ff]">{question.topic}</h2>
            ) : null}
            {hasFeedback ? (
              <div dangerouslySetInnerHTML={{ __html: explanationHtml }} />
            ) : (
              <div className="py-4 text-[#80868b] animate-pulse">Fetching explanation...</div>
            )}
          </div>

          {currentIndex < questionCount - 1 ? (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onNext}
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
  );
}

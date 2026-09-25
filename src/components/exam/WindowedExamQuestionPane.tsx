'use client';

import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AnswerOptionList } from '@/components/exam/AnswerOptionList';
import { ExamAnnotationLayer } from '@/components/exam/ExamAnnotationLayer';
import type {
  AnnotationStroke,
  AnnotationSurface,
  AnnotationTool,
  StoredQuestionAnnotation,
} from '@/lib/exam-annotations';
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
  isReviewMode?: boolean;
  isTimedMode: boolean;
  selectedOptionId: number | null;
  struckOutOptionIds: Set<number>;
  submittedAnswer?: ExamClientAnswer;
  correctOptionId: number | null;
  optionPercentages: Record<number, number>;
  isSaving: boolean;
  isSaveConfirmed?: boolean;
  canRetrySave?: boolean;
  isSubmitting: boolean;
  annotationTool: AnnotationTool | null;
  annotationRecords: Partial<Record<AnnotationSurface, StoredQuestionAnnotation>>;
  onAppendAnnotationStroke: (
    surface: AnnotationSurface,
    contentHash: string,
    stroke: AnnotationStroke,
  ) => void;
  onEraseAnnotationStroke: (
    surface: AnnotationSurface,
    contentHash: string,
    strokeId: string,
  ) => void;
  onUpdateAnnotationStroke: (
    surface: AnnotationSurface,
    contentHash: string,
    stroke: AnnotationStroke,
  ) => void;
  onSelectOption: (questionId: number, option: ExamClientOption) => void;
  onToggleStrikeOut: (optionId: number) => void;
  onSubmitAnswer: () => void;
  onRetrySave: () => void;
  onRetryFeedback: () => void;
  onPrev: () => void;
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
  isReviewMode = false,
  isTimedMode,
  selectedOptionId,
  struckOutOptionIds,
  submittedAnswer,
  correctOptionId,
  optionPercentages,
  isSaving,
  isSaveConfirmed = false,
  canRetrySave = false,
  isSubmitting,
  annotationTool,
  annotationRecords,
  onAppendAnnotationStroke,
  onEraseAnnotationStroke,
  onUpdateAnnotationStroke,
  onSelectOption,
  onToggleStrikeOut,
  onSubmitAnswer,
  onRetrySave,
  onRetryFeedback,
  onPrev,
  onNext,
  onExplanationClick,
}: WindowedExamQuestionPaneProps) {
  const optionsFingerprint = JSON.stringify(
    (question.options || []).map((option) => [option.id, option.text_html]),
  );
  const explanationFingerprint = explanationHtml
    .replace(/aria-pressed="(?:true|false)"/g, 'aria-pressed="false"')
    .replace(/>Bookmarked</g, '>Bookmark concept<');

  return (
    <section className="min-w-0 pb-0 md:pb-10">
      <div className="relative">
        <div
          data-annotation-content="true"
          className={`pm-question-stem select-text text-[16px] leading-[1.55] text-white ${
            showClues ? 'pm-show-clues' : 'pm-hide-clues'
          }`}
          dangerouslySetInnerHTML={{ __html: questionHtml }}
        />
        <ExamAnnotationLayer
          surface="stem"
          contentFingerprint={questionHtml}
          tool={annotationTool}
          record={annotationRecords.stem}
          onAppendStroke={onAppendAnnotationStroke}
          onEraseStroke={onEraseAnnotationStroke}
          onUpdateStroke={onUpdateAnnotationStroke}
        />
      </div>

      <div className="relative">
        <div data-annotation-content="true">
          <AnswerOptionList
            isAnswered={isAnswered}
            isTimedMode={isTimedMode}
            pendingSelectionId={selectedOptionId}
            question={question}
            struckOutOptionIds={struckOutOptionIds}
            submittedAnswer={submittedAnswer}
            correctOptionId={correctOptionId}
            optionPercentages={optionPercentages}
            annotationTextMode={annotationTool === 'highlighter'}
            onSelectOption={onSelectOption}
            onToggleStrikeOut={onToggleStrikeOut}
          />
        </div>
        <ExamAnnotationLayer
          surface="options"
          contentFingerprint={optionsFingerprint}
          tool={annotationTool}
          record={annotationRecords.options}
          onAppendStroke={onAppendAnnotationStroke}
          onEraseStroke={onEraseAnnotationStroke}
          onUpdateStroke={onUpdateAnnotationStroke}
        />
      </div>

      {!isReviewMode && !isTimedMode && !isAnswered ? (
        <div className="mt-6 hidden items-center gap-3 md:flex">
          <button
            type="button"
            onClick={onSubmitAnswer}
            disabled={!selectedOptionId || isSaving || isSubmitting}
            className="inline-flex h-[34px] items-center rounded-[4px] bg-[#7f1fff] px-4 text-[14px] font-medium text-white hover:bg-[#8d33ff] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {isSaving ? 'Preparing feedback...' : 'Submit answer'}
          </button>
          {!selectedOptionId ? (
            <span className="text-[12px] text-[#a8aeb4]">Choose one option first.</span>
          ) : null}
        </div>
      ) : null}

      {!isReviewMode && isTimedMode ? (
        <p className="mt-3 text-[11px] text-[#a8aeb4]">
          Selections are saved automatically and can be changed until End Block.
        </p>
      ) : null}

      {!isReviewMode && isAnswered ? (
        <div className="mt-3 flex items-center gap-3 text-[11px] text-[#a8aeb4]" aria-live="polite">
          <span>{isSaving ? 'Saving answer…' : isSaveConfirmed ? 'Saved' : canRetrySave ? 'Answer save failed.' : ''}</span>
          {canRetrySave && !isSaving ? (
            <button
              type="button"
              onClick={onRetrySave}
              disabled={isSubmitting}
              className="rounded-[3px] border border-[#6f7680] px-2 py-1 text-[#d9dce0] hover:border-[#9aa1aa] disabled:opacity-45"
            >
              Retry save
            </button>
          ) : null}
        </div>
      ) : null}

      {isAnswered && !isTimedMode ? (
        <div className="space-y-6 pt-6">
          <div className="relative">
            <div
              className="pm-explanation-container text-[16px] leading-[1.7] text-white"
              onClick={onExplanationClick}
            >
              {question.topic ? (
                <h2 className="mb-5 text-[16px] font-semibold text-[#23a7ff]">{question.topic}</h2>
              ) : null}
              {hasFeedback ? (
                <div
                  data-annotation-content="true"
                  className="select-text"
                  dangerouslySetInnerHTML={{ __html: explanationHtml }}
                />
              ) : (
                <div className="py-4 text-[#80868b]">
                  <div className="animate-pulse">
                    {isReviewMode ? 'Loading review details...' : 'Fetching explanation...'}
                  </div>
                  {!isReviewMode && !isSaving ? (
                    <button
                      type="button"
                      onClick={onRetryFeedback}
                      disabled={isSubmitting}
                      className="mt-3 rounded-[3px] border border-[#6f7680] px-2 py-1 text-[11px] text-[#d9dce0] hover:border-[#9aa1aa] disabled:opacity-45"
                    >
                      Retry explanation
                    </button>
                  ) : null}
                </div>
              )}
            </div>
            {hasFeedback ? (
              <ExamAnnotationLayer
                surface="explanation"
                contentFingerprint={explanationFingerprint}
                tool={annotationTool}
                record={annotationRecords.explanation}
                onAppendStroke={onAppendAnnotationStroke}
                onEraseStroke={onEraseAnnotationStroke}
                onUpdateStroke={onUpdateAnnotationStroke}
              />
            ) : null}
          </div>

          {currentIndex < questionCount - 1 ? (
            <div className="hidden justify-end md:flex">
              <button
                type="button"
                onClick={onNext}
                className="inline-flex h-[36px] items-center gap-2 rounded-[4px] bg-[#7f1fff] px-4 text-[14px] font-medium text-white hover:bg-[#8d33ff]"
              >
                <span>{isReviewMode ? 'Next review question' : 'Next question'}</span>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-[120] border-t border-[#e2dbcf] bg-[#fffdfa]/95 px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-2 shadow-[0_-8px_24px_rgba(16,36,63,0.08)] backdrop-blur md:hidden dark:border-[#3f4348] dark:bg-[#282828]/95 dark:shadow-[0_-8px_24px_rgba(0,0,0,0.28)]">
        {!isReviewMode && !isTimedMode && !isAnswered ? (
          <div>
            <div className="grid grid-cols-[42px_minmax(0,1fr)_42px] items-center gap-2">
              <button
                type="button"
                onClick={onPrev}
                disabled={currentIndex === 0 || isSubmitting}
                className="grid h-[42px] place-items-center rounded-[9px] border border-[#d8c8aa] bg-[#fffdfa] text-[#10243f] disabled:opacity-30 dark:border-[#5a5f64] dark:bg-[#30363b] dark:text-white"
                aria-label="Previous question"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onSubmitAnswer}
                disabled={!selectedOptionId || isSaving || isSubmitting}
                className="inline-flex h-[44px] items-center justify-center rounded-[9px] bg-[#b88a32] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#9a6d24] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isSaving ? 'Preparing feedback...' : 'Submit answer'}
              </button>
              <button
                type="button"
                onClick={onNext}
                disabled={currentIndex >= questionCount - 1 || isSubmitting}
                className="grid h-[42px] place-items-center rounded-[9px] border border-[#d8c8aa] bg-[#fffdfa] text-[#10243f] disabled:opacity-30 dark:border-[#5a5f64] dark:bg-[#30363b] dark:text-white"
                aria-label="Next question"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            {!selectedOptionId ? (
              <p className="mt-1.5 text-center text-[9px] text-[#788494] dark:text-[#a8aeb4]">Choose one option first, or move to another question.</p>
            ) : null}
          </div>
        ) : (
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <button
              type="button"
              onClick={onPrev}
              disabled={currentIndex === 0 || isSubmitting}
              className="inline-flex h-[42px] items-center justify-center rounded-[9px] border border-[#d8c8aa] bg-[#fffdfa] px-3 text-[11px] font-semibold text-[#10243f] disabled:opacity-35 dark:border-[#5a5f64] dark:bg-[#30363b] dark:text-white"
            >
              Previous
            </button>
            <span className="min-w-[58px] text-center text-[10px] font-semibold text-[#7b8794] dark:text-[#a8aeb4]">
              {currentIndex + 1} / {questionCount}
            </span>
            <button
              type="button"
              onClick={onNext}
              disabled={currentIndex >= questionCount - 1 || isSubmitting}
              className="inline-flex h-[42px] items-center justify-center rounded-[9px] bg-[#b88a32] px-3 text-[11px] font-semibold text-white disabled:opacity-35"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

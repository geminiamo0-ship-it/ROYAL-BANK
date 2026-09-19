'use client';

import React from 'react';
import type { ExamClientAnswer, ExamClientOption, ExamClientQuestion } from '@/types/exam';
import { Ban, X } from 'lucide-react';

interface AnswerOptionListProps {
  isAnswered: boolean;
  isTimedMode?: boolean;
  pendingSelectionId: number | null;
  question: ExamClientQuestion;
  struckOutOptionIds: Set<number>;
  submittedAnswer?: ExamClientAnswer;
  correctOptionId: number | null;
  optionPercentages: Record<number, number>;
  annotationTextMode?: boolean;
  onSelectOption: (questionId: number, option: ExamClientOption) => void;
  onToggleStrikeOut: (optionId: number) => void;
}

export function AnswerOptionList({
  isAnswered,
  isTimedMode = false,
  pendingSelectionId,
  question,
  struckOutOptionIds,
  submittedAnswer,
  correctOptionId,
  optionPercentages,
  annotationTextMode = false,
  onSelectOption,
  onToggleStrikeOut,
}: AnswerOptionListProps) {
  const selectedOptionId = submittedAnswer?.selectedOptionId ?? pendingSelectionId ?? null;
  const options = question.options || [];
  const canEdit = !isAnswered || isTimedMode;
  const showFeedback = isAnswered && !isTimedMode && correctOptionId != null;

  if (options.length === 0) {
    return (
      <div className="my-6 border border-[#5d6267] px-4 py-5 text-center text-[12px] text-[#b9c0c6]">
        Loading answer options...
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-0 border border-[#8a8e93]">
      {options.map((option, index) => {
        const isSelected = selectedOptionId === option.id;
        const isCorrectOption = correctOptionId === option.id;
        const isStruck = struckOutOptionIds.has(option.id);
        const percentage = Math.round(optionPercentages[option.id] ?? 0);

        let rowClassName = 'bg-transparent';
        let barClassName = 'bg-[#6a7076]';

        if (showFeedback) {
          if (isCorrectOption) {
            rowClassName = 'bg-[#248f57]';
            barClassName = 'bg-[#248f57]';
          } else if (isSelected) {
            rowClassName = 'bg-[#df3e53]';
            barClassName = 'bg-[#df3e53]';
          }
        } else if (isSelected) {
          rowClassName = 'bg-[#343a43]';
        }

        return (
          <div
            key={option.id}
            className={`group relative overflow-hidden ${index > 0 ? 'border-t border-[#8a8e93]' : ''} ${isStruck ? 'opacity-45' : ''}`}
          >
            {showFeedback ? (
              <div
                className={`absolute inset-y-0 left-0 transition-all duration-500 ${barClassName}`}
                style={{ width: `${percentage}%` }}
              />
            ) : null}

            <div className={`relative z-10 flex min-h-[44px] items-center gap-3 px-3 py-[10px] text-[14px] ${rowClassName}`}>
              {annotationTextMode ? (
                <div className="flex min-w-0 flex-1 cursor-text select-text items-center gap-4 text-left text-white">
                  <span
                    className={`flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border ${
                      isSelected ? 'border-white' : 'border-[#d8d8d8]'
                    }`}
                    aria-hidden="true"
                  >
                    {isSelected && (!showFeedback || isTimedMode) ? (
                      <span className="h-[8px] w-[8px] rounded-full bg-white" />
                    ) : null}
                  </span>
                  <span
                    className={`min-w-0 flex-1 select-text ${isStruck ? 'line-through' : ''}`}
                    dangerouslySetInnerHTML={{ __html: option.text_html }}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => canEdit && onSelectOption(question.id, option)}
                  disabled={!canEdit}
                  className="flex min-w-0 flex-1 items-center gap-4 text-left text-white disabled:cursor-default"
                >
                  <span
                    className={`flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border ${
                      isSelected ? 'border-white' : 'border-[#d8d8d8]'
                    }`}
                  >
                    {isSelected && (!showFeedback || isTimedMode) ? (
                      <span className="h-[8px] w-[8px] rounded-full bg-white" />
                    ) : null}
                  </span>

                  <span
                    className={`min-w-0 flex-1 ${isStruck ? 'line-through' : ''}`}
                    dangerouslySetInnerHTML={{ __html: option.text_html }}
                  />
                </button>
              )}

              {showFeedback ? (
                <span data-annotation-ignore="true" className="rounded-full bg-[#7f8790] px-2 py-[2px] text-[11px] font-semibold text-white">
                  {percentage}%
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onToggleStrikeOut(option.id)}
                  className={`flex h-[20px] w-[20px] items-center justify-center text-[#f1f1f1] ${
                    annotationTextMode
                      ? 'pointer-events-none opacity-0'
                      : isStruck
                        ? 'text-[#ff707c]'
                        : 'opacity-0 group-hover:opacity-100'
                  }`}
                  title="Strike out option"
                >
                  {isStruck ? <Ban className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

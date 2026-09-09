'use client';

import { useEffect } from 'react';
import type { ExamClientOption, ExamClientQuestion } from '@/types/exam';

export function useExamKeyboardShortcuts({
  question,
  isSubmitting,
  isTimedMode,
  onNext,
  onPrev,
  onToggleFlag,
  onSelectOption,
  onSubmitAnswer,
}: {
  question: ExamClientQuestion | undefined;
  isSubmitting: boolean;
  isTimedMode: boolean;
  onNext: () => void;
  onPrev: () => void;
  onToggleFlag: (questionId: number) => void;
  onSelectOption: (questionId: number, option: ExamClientOption) => void;
  onSubmitAnswer: (questionId: number) => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement).tagName)) return;
      if (!question || isSubmitting) return;

      if (event.key === 'ArrowRight') {
        onNext();
        return;
      }
      if (event.key === 'ArrowLeft') {
        onPrev();
        return;
      }
      if (event.key.toLowerCase() === 'f') {
        onToggleFlag(question.id);
        return;
      }
      if (['1', '2', '3', '4', '5'].includes(event.key)) {
        const option = question.options?.[Number(event.key) - 1];
        if (option) onSelectOption(question.id, option);
        return;
      }
      if (event.key === 'Enter' && !isTimedMode) {
        onSubmitAnswer(question.id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isSubmitting,
    isTimedMode,
    onNext,
    onPrev,
    onSelectOption,
    onSubmitAnswer,
    onToggleFlag,
    question,
  ]);
}

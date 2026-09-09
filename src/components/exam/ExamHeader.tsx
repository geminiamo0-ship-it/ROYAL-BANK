'use client';

import React from 'react';
import { ArrowLeft, ArrowRight, ChevronDown, Clock3, Eye, Flag, Lightbulb, X } from 'lucide-react';
import { formatTime } from '@/lib/utils';

interface ExamHeaderProps {
  currentIndex: number;
  elapsedSeconds: number;
  isFlagged: boolean;
  isReviewMode?: boolean;
  questionCount: number;
  showClues: boolean;
  onSuspend: () => void;
  onEndBlock: () => void;
  onNext: () => void;
  onPrev: () => void;
  onToggleClues: () => void;
  onToggleFlag: () => void;
}

export function ExamHeader({
  currentIndex,
  elapsedSeconds,
  isFlagged,
  isReviewMode = false,
  questionCount,
  showClues,
  onSuspend,
  onEndBlock,
  onNext,
  onPrev,
  onToggleClues,
  onToggleFlag,
}: ExamHeaderProps) {
  return (
    <header className="border-b border-[#3f4348] px-4 pb-3 pt-2 text-white">
      <div className="mx-auto flex max-w-[1240px] items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-end gap-[3px]">
            <span className="h-[14px] w-[5px] bg-[#ff2020]" />
            <span className="h-[18px] w-[5px] bg-[#fff100]" />
            <span className="h-[23px] w-[5px] bg-[#47d41f]" />
          </div>
          <span className="text-[15px] font-semibold tracking-[-0.2px] text-[#f5f5f5]">RoyalBank</span>
          {isReviewMode ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#745b91] bg-[#3a3045] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#d9b7ff]">
              <Eye className="h-3 w-3" /> Completed review
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-5 text-[12px] text-[#cf95ff]">
          <button type="button" onClick={onSuspend} className="hover:text-white">
            {isReviewMode ? 'Exit review' : 'Suspend'}
          </button>
          {!isReviewMode ? (
            <button type="button" onClick={onEndBlock} className="hover:text-white">
              End block
            </button>
          ) : null}
        </div>
      </div>

      <div className="mx-auto mt-3 grid max-w-[1240px] gap-3 lg:grid-cols-[1fr_auto]">
        <div className="grid grid-cols-[42px_1fr_42px_42px_42px] items-center gap-3 border-b border-[#8c8f92] pb-2">
          <button
            type="button"
            onClick={onPrev}
            disabled={currentIndex === 0}
            className="flex h-[32px] w-[32px] items-center justify-center rounded-full bg-[#2f80ff] text-white disabled:cursor-not-allowed disabled:opacity-40"
            title="Previous Question"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <div className="text-center text-[14px] font-medium text-[#f4f4f4]">
            Question {currentIndex + 1} of {questionCount || 1}
          </div>

          <button
            type="button"
            onClick={onSuspend}
            className="flex h-[32px] w-[32px] items-center justify-center text-[#ff2f3e]"
            title={isReviewMode ? 'Exit review' : 'Suspend and exit'}
          >
            <X className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onToggleFlag}
            className={`flex h-[32px] w-[32px] items-center justify-center ${
              isFlagged ? 'text-[#ffd36e]' : 'text-[#666b70]'
            }`}
            title="Flag question"
          >
            <Flag className={`h-4 w-4 ${isFlagged ? 'fill-[#ffd36e]' : ''}`} />
          </button>

          <button
            type="button"
            onClick={onNext}
            disabled={currentIndex >= questionCount - 1}
            className="flex h-[32px] w-[32px] items-center justify-center justify-self-end rounded-full bg-[#2f80ff] text-white disabled:cursor-not-allowed disabled:opacity-40"
            title="Next Question"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-3 justify-self-start lg:justify-self-end">
          <button
            type="button"
            className="inline-flex h-[30px] items-center gap-2 rounded-[4px] border border-[#d7d7d7] bg-[#2d2d2d] px-3 text-[12px] text-white"
          >
            <span>Reference ranges</span>
            <ChevronDown className="h-3.5 w-3.5 text-[#d0d0d0]" />
          </button>

          <button
            type="button"
            onClick={onToggleClues}
            className={`inline-flex h-[30px] items-center gap-2 rounded-[4px] px-3 text-[12px] ${
              showClues
                ? 'bg-[#ffe8a3] text-[#4d3a00]'
                : 'border border-[#5a5f64] bg-[#363636] text-[#e6e6e6]'
            }`}
          >
            <Lightbulb className={`h-3.5 w-3.5 ${showClues ? 'fill-current' : ''}`} />
            <span>{showClues ? 'Clues on' : 'Clues'}</span>
          </button>

          {isReviewMode ? (
            <div className="inline-flex h-[30px] items-center gap-2 rounded-[4px] border border-[#745b91] bg-[#3a3045] px-3 text-[12px] text-[#d9b7ff]">
              <Eye className="h-3.5 w-3.5" />
              <span>Read only</span>
            </div>
          ) : (
            <div className="inline-flex h-[30px] items-center gap-2 rounded-[4px] border border-[#5a5f64] bg-[#363636] px-3 text-[12px] text-[#eaeaea]">
              <Clock3 className="h-3.5 w-3.5 text-[#a7adb3]" />
              <span className="font-mono">{formatTime(elapsedSeconds)}</span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

'use client';

import React from 'react';
import { Hammer } from 'lucide-react';
import { QuestionBankPanelHeader } from '@/components/bank/QuestionBankPanelHeader';
import { QUESTION_SELECTION_OPTIONS } from '@/lib/question-bank-selection';
import type { QuestionSelection, SessionType } from '@/types/database';

type BankSessionMode = Extract<SessionType, 'tutor' | 'timed'>;

interface QuestionBankControlsProps {
  sessionMode: BankSessionMode;
  selectedQuestions: number;
  boundedQuestionCount: number;
  selectedDifficulties: string[];
  questionSelection: QuestionSelection;
  selectionLabel: string;
  onSessionModeChange: (mode: BankSessionMode) => void;
  onQuestionCountChange: (count: number) => void;
  onToggleDifficulty: (difficulty: string) => void;
  onQuestionSelectionChange: (selection: QuestionSelection) => void;
}

export function QuestionBankControls({
  sessionMode,
  selectedQuestions,
  boundedQuestionCount,
  selectedDifficulties,
  questionSelection,
  selectionLabel,
  onSessionModeChange,
  onQuestionCountChange,
  onToggleDifficulty,
  onQuestionSelectionChange,
}: QuestionBankControlsProps) {
  const maxQuestionCount = Math.min(70, Math.max(1, selectedQuestions));

  return (
    <div className="space-y-[12px]">
      <section className="rounded-[4px] bg-[#353c42] shadow-[0_1px_3px_rgba(0,0,0,0.28)]">
        <QuestionBankPanelHeader title="Question mode" />
        <div className="p-3">
          <div className="mb-4 grid grid-cols-2 gap-3">
            <ModeButton
              active={sessionMode === 'tutor'}
              title="Tutor"
              description="Answer shown after each question"
              onClick={() => onSessionModeChange('tutor')}
            />
            <ModeButton
              active={sessionMode === 'timed'}
              title="Timed"
              description="Custom time per question"
              onClick={() => onSessionModeChange('timed')}
            />
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[12px] text-[#c6cdd3]">No. of questions</span>
            <div className="flex items-center rounded-[4px] border border-[#4a545d] bg-[#22272b]">
              <button
                type="button"
                onClick={() => onQuestionCountChange(Math.max(1, boundedQuestionCount - 1))}
                className="flex h-7 w-7 items-center justify-center text-[#c6cdd3] hover:text-white"
              >
                -
              </button>
              <input
                type="number"
                min={1}
                max={maxQuestionCount}
                value={boundedQuestionCount}
                onChange={(event) => {
                  const value = Number.parseInt(event.target.value, 10);
                  if (Number.isNaN(value)) return;
                  onQuestionCountChange(Math.min(maxQuestionCount, Math.max(1, value)));
                }}
                className="w-12 bg-transparent text-center text-[13px] font-semibold text-white outline-none"
              />
              <button
                type="button"
                onClick={() => onQuestionCountChange(Math.min(maxQuestionCount, boundedQuestionCount + 1))}
                className="flex h-7 w-7 items-center justify-center text-[#c6cdd3] hover:text-white"
              >
                +
              </button>
            </div>
            <span className="text-[11px] text-[#8e9ba4]">of {selectedQuestions.toLocaleString()}</span>
          </div>
        </div>
      </section>

      <section className="rounded-[4px] bg-[#353c42] shadow-[0_1px_3px_rgba(0,0,0,0.28)]">
        <QuestionBankPanelHeader title="Difficulty" />
        <div className="flex flex-wrap gap-8 px-[12px] py-[14px]">
          {[
            { value: '1', hammers: 1 },
            { value: '2', hammers: 2 },
            { value: '3', hammers: 3 },
          ].map((difficulty) => (
            <label key={difficulty.value} className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-white">
              <input
                type="checkbox"
                checked={selectedDifficulties.includes(difficulty.value)}
                onChange={() => onToggleDifficulty(difficulty.value)}
                className="h-[14px] w-[14px] cursor-pointer rounded-[2px] accent-[#3e73ff]"
              />
              <span className="flex items-center gap-[2px]">
                {Array.from({ length: difficulty.hammers }).map((_, index) => (
                  <Hammer
                    key={index}
                    size={15}
                    className={selectedDifficulties.includes(difficulty.value) ? 'text-[#ff9500]' : 'text-[#5a646c]'}
                    strokeWidth={2.5}
                  />
                ))}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-[4px] bg-[#353c42] shadow-[0_1px_3px_rgba(0,0,0,0.28)]">
        <QuestionBankPanelHeader title="Question selection" />
        <div className="space-y-[8px] px-[12px] py-[12px]">
          <div className="rounded-[3px] border border-[#46505a] bg-[#2f353a] px-3 py-2 text-[11px] text-[#dfe7ee]">
            Current filter:{' '}
            <span className="font-semibold text-white">
              {selectedQuestions.toLocaleString()} {selectionLabel}
            </span>
          </div>
          {QUESTION_SELECTION_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onQuestionSelectionChange(option.value)}
              className={`flex h-[28px] w-full items-center rounded-[3px] border px-3 text-left text-[12px] transition-colors ${
                questionSelection === option.value
                  ? 'border-[#b9cbf7] bg-[#2c3d5e] text-white'
                  : 'border-[#80868b] bg-[#34393e] text-[#edf1f4] hover:border-[#aeb8c2]'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ModeButton({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start justify-center rounded-[4px] border p-3 text-left transition-colors ${
        active
          ? 'border-[#3e73ff] bg-[#2c3d5e] text-[#f4f4f4]'
          : 'border-[#4a545d] bg-[#2c3237] text-[#c6cdd3] hover:border-[#80868b]'
      }`}
    >
      <span className="font-semibold">{title}</span>
      <span className="mt-1 text-[11px] opacity-70">{description}</span>
    </button>
  );
}

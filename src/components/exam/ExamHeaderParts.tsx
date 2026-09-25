'use client';

import React, { useState } from 'react';
import { Eye, Flag, Lightbulb, Wrench } from 'lucide-react';
import { ExamClock } from '@/components/exam/ExamClock';
import type { AnnotationColor } from '@/lib/exam-annotations';

type CalcOperator = '+' | '-' | '×' | '÷';

export const COLOR_SWATCHES: readonly { color: AnnotationColor; label: string; hex: string }[] = [
  { color: 'yellow', label: 'Yellow', hex: '#ffd84d' },
  { color: 'red', label: 'Red', hex: '#ff4d5a' },
  { color: 'blue', label: 'Blue', hex: '#4da3ff' },
  { color: 'green', label: 'Green', hex: '#55d66b' },
  { color: 'purple', label: 'Purple', hex: '#b27cff' },
];

function applyOperator(left: number, right: number, operator: CalcOperator): number {
  if (operator === '+') return left + right;
  if (operator === '-') return left - right;
  if (operator === '×') return left * right;
  if (right === 0) return Number.NaN;
  return left / right;
}

function formatCalculatorNumber(value: number): string {
  if (!Number.isFinite(value)) return 'Error';
  return String(Number(value.toPrecision(10)));
}

export function MiniCalculator() {
  const [display, setDisplay] = useState('0');
  const [accumulator, setAccumulator] = useState<number | null>(null);
  const [operator, setOperator] = useState<CalcOperator | null>(null);
  const [replaceDisplay, setReplaceDisplay] = useState(true);

  const inputDigit = (digit: string) => {
    setDisplay((current) => {
      if (current === 'Error' || replaceDisplay) return digit;
      if (current.length >= 14) return current;
      return current === '0' ? digit : `${current}${digit}`;
    });
    setReplaceDisplay(false);
  };

  const inputDecimal = () => {
    setDisplay((current) => {
      if (current === 'Error' || replaceDisplay) return '0.';
      return current.includes('.') ? current : `${current}.`;
    });
    setReplaceDisplay(false);
  };

  const chooseOperator = (nextOperator: CalcOperator) => {
    const current = Number(display);
    if (!Number.isFinite(current)) {
      setDisplay('0');
      setAccumulator(null);
      setOperator(nextOperator);
      setReplaceDisplay(true);
      return;
    }

    if (accumulator == null || operator == null || replaceDisplay) {
      setAccumulator(accumulator == null ? current : accumulator);
    } else {
      const result = applyOperator(accumulator, current, operator);
      setAccumulator(result);
      setDisplay(formatCalculatorNumber(result));
    }
    setOperator(nextOperator);
    setReplaceDisplay(true);
  };

  const equals = () => {
    if (accumulator == null || operator == null) return;
    const current = Number(display);
    const result = applyOperator(accumulator, current, operator);
    setDisplay(formatCalculatorNumber(result));
    setAccumulator(null);
    setOperator(null);
    setReplaceDisplay(true);
  };

  const clear = () => {
    setDisplay('0');
    setAccumulator(null);
    setOperator(null);
    setReplaceDisplay(true);
  };

  const toggleSign = () => {
    const current = Number(display);
    if (!Number.isFinite(current)) return;
    setDisplay(formatCalculatorNumber(current * -1));
  };

  return (
    <div className="w-[230px]">
      <div className="mb-2 rounded border border-[#555d64] bg-[#1f2326] px-3 py-2 text-right font-mono text-[18px] text-white">
        {display}
      </div>
      <div className="grid grid-cols-4 gap-1.5 text-[13px]">
        <button type="button" onClick={clear} className="rounded bg-[#5a3131] py-2 hover:bg-[#6a3a3a]">C</button>
        <button type="button" onClick={toggleSign} className="rounded bg-[#444a50] py-2 hover:bg-[#50575e]">±</button>
        <button type="button" onClick={() => chooseOperator('÷')} className="rounded bg-[#444a50] py-2 hover:bg-[#50575e]">÷</button>
        <button type="button" onClick={() => chooseOperator('×')} className="rounded bg-[#444a50] py-2 hover:bg-[#50575e]">×</button>
        {['7', '8', '9'].map((digit) => <button key={digit} type="button" onClick={() => inputDigit(digit)} className="rounded bg-[#353b40] py-2 hover:bg-[#41484e]">{digit}</button>)}
        <button type="button" onClick={() => chooseOperator('-')} className="rounded bg-[#444a50] py-2 hover:bg-[#50575e]">−</button>
        {['4', '5', '6'].map((digit) => <button key={digit} type="button" onClick={() => inputDigit(digit)} className="rounded bg-[#353b40] py-2 hover:bg-[#41484e]">{digit}</button>)}
        <button type="button" onClick={() => chooseOperator('+')} className="rounded bg-[#444a50] py-2 hover:bg-[#50575e]">+</button>
        {['1', '2', '3'].map((digit) => <button key={digit} type="button" onClick={() => inputDigit(digit)} className="rounded bg-[#353b40] py-2 hover:bg-[#41484e]">{digit}</button>)}
        <button type="button" onClick={equals} className="row-span-2 rounded bg-[#2f80ff] py-2 hover:bg-[#458eff]">=</button>
        <button type="button" onClick={() => inputDigit('0')} className="col-span-2 rounded bg-[#353b40] py-2 hover:bg-[#41484e]">0</button>
        <button type="button" onClick={inputDecimal} className="rounded bg-[#353b40] py-2 hover:bg-[#41484e]">.</button>
      </div>
    </div>
  );
}

export function ToolButton({
  active = false,
  disabled = false,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`inline-flex h-[30px] shrink-0 items-center gap-2 rounded-[4px] border px-3 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
        active
          ? 'border-[#e5c64b] bg-[#5a4d1e] text-[#fff0a3]'
          : 'border-[#5a5f64] bg-[#363636] text-[#e6e6e6] hover:bg-[#414141]'
      }`}
    >
      {children}
    </button>
  );
}

export function MobileToolTile({
  active = false,
  onClick,
  icon,
  label,
  wide = false,
}: {
  active?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[72px] flex-col items-center justify-center gap-2 rounded-[12px] border text-[11px] font-semibold transition-colors ${wide ? 'col-span-2' : ''} ${
        active
          ? 'border-[#b88a32] bg-[#f4ead7] text-[#8f6522] dark:border-[#d5ad5c] dark:bg-[#4d4023] dark:text-[#fff0a3]'
          : 'border-[#e1d5c2] bg-[#fbf7ef] text-[#10243f] dark:border-[#596168] dark:bg-[#30363b] dark:text-white'
      }`}
    >
      <span className="text-[#a27d3f] dark:text-[#d5ad5c]">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

export function ExamMobileHeader({
  currentIndex,
  questionCount,
  isFlagged,
  isReviewMode,
  clockStartedAtMs,
  clockDeadlineAtMs,
  serverClockOffsetMs,
  showClues,
  onToggleFlag,
  onEndBlock,
  onToggleClues,
  onOpenTools,
}: {
  currentIndex: number;
  questionCount: number;
  isFlagged: boolean;
  isReviewMode: boolean;
  clockStartedAtMs: number | null;
  clockDeadlineAtMs: number | null;
  serverClockOffsetMs: number;
  showClues: boolean;
  onToggleFlag: () => void;
  onEndBlock: () => void;
  onToggleClues: () => void;
  onOpenTools: () => void;
}) {
  const progressPercent = questionCount > 0
    ? Math.min(100, Math.max(0, ((currentIndex + 1) / questionCount) * 100))
    : 0;

  return (
    <header className="relative z-[80] shrink-0 border-b border-[#e2dbcf] bg-[#fffdfa] px-3 pb-2 pt-2 text-[#10243f] dark:border-[#3f4348] dark:bg-[#282828] dark:text-white md:hidden">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex items-end gap-[2px]" aria-hidden="true">
            <span className="h-[11px] w-[4px] bg-[#ff2020]" />
            <span className="h-[15px] w-[4px] bg-[#e4b62e]" />
            <span className="h-[20px] w-[4px] bg-[#47b92f]" />
          </div>
          <span className="hidden text-[13px] font-semibold min-[390px]:inline">RoyalBank</span>
          <span className="whitespace-nowrap text-[12px] font-semibold">
            Question {currentIndex + 1} of {questionCount || 1}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleFlag}
            title={isFlagged ? 'Remove flag' : 'Flag question'}
            aria-pressed={isFlagged}
            className={`grid h-[34px] w-[36px] place-items-center rounded-[8px] border transition-colors ${
              isFlagged
                ? 'border-[#b88a32] bg-[#f4ead7] text-[#9f7321] dark:border-[#d5ad5c] dark:bg-[#4d4023] dark:text-[#f0c967]'
                : 'border-[#d8c8aa] bg-[#fbf7ef] text-[#9a7a45] dark:border-[#5a5f64] dark:bg-[#363636] dark:text-[#d9dce0]'
            }`}
          >
            <Flag className={`h-4 w-4 ${isFlagged ? 'fill-current' : ''}`} />
          </button>

          {isReviewMode ? (
            <div className="inline-flex h-[34px] items-center gap-1.5 rounded-[8px] border border-[#c9b3d9] bg-[#f3edf8] px-2.5 text-[10px] font-semibold text-[#7655bd] dark:border-[#745b91] dark:bg-[#3a3045] dark:text-[#d9b7ff]">
              <Eye className="h-3.5 w-3.5" />
              <span>Review</span>
            </div>
          ) : (
            <ExamClock
              startedAtMs={clockStartedAtMs}
              deadlineAtMs={clockDeadlineAtMs}
              serverClockOffsetMs={serverClockOffsetMs}
              variant="mobile"
            />
          )}

          {!isReviewMode ? (
            <button
              type="button"
              onClick={onEndBlock}
              className="h-[34px] rounded-[8px] px-2 text-[10px] font-semibold leading-3 text-[#9a6d24] hover:bg-[#f4ead7] dark:text-[#d7a6ff] dark:hover:bg-[#3a3045]"
            >
              End<br />block
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-2 h-[4px] overflow-hidden rounded-full bg-[#eee6d9] dark:bg-[#3f4348]">
        <div
          className="h-full rounded-full bg-[#b88a32] transition-[width] duration-200 dark:bg-[#d5ad5c]"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onToggleClues}
          aria-pressed={showClues}
          className={`inline-flex h-[40px] items-center justify-center gap-2 rounded-[8px] border text-[12px] font-semibold transition-colors ${
            showClues
              ? 'border-[#b88a32] bg-[#f4ead7] text-[#8f6522] dark:border-[#d5ad5c] dark:bg-[#4d4023] dark:text-[#fff0a3]'
              : 'border-[#dfd2bc] bg-[#fffdfa] text-[#10243f] dark:border-[#5a5f64] dark:bg-[#30363b] dark:text-white'
          }`}
        >
          <Lightbulb className={`h-4 w-4 ${showClues ? 'fill-current' : ''}`} />
          <span>{showClues ? 'Clues on' : 'Clues'}</span>
        </button>

        <button
          type="button"
          onClick={onOpenTools}
          className="inline-flex h-[40px] items-center justify-center gap-2 rounded-[8px] border border-[#dfd2bc] bg-[#fffdfa] text-[12px] font-semibold text-[#10243f] dark:border-[#5a5f64] dark:bg-[#30363b] dark:text-white"
        >
          <Wrench className="h-4 w-4 text-[#9f7321] dark:text-[#d5ad5c]" />
          <span>Tools</span>
        </button>
      </div>
    </header>
  );
}

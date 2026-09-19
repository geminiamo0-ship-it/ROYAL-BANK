'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  ArrowLeft,
  ArrowRight,
  Calculator,
  ChevronDown,
  Eraser,
  Eye,
  Flag,
  Highlighter,
  Lightbulb,
  Maximize2,
  Minimize2,
  MousePointer2,
  Pencil,
  Redo2,
  Trash2,
  Undo2,
} from 'lucide-react';
import { ExamClock } from '@/components/exam/ExamClock';
import {
  ANNOTATION_COLOR_STORAGE_KEY,
  DEFAULT_ANNOTATION_COLOR,
  isAnnotationColor,
  type AnnotationColor,
  type AnnotationTool,
} from '@/lib/exam-annotations';

interface ExamHeaderProps {
  currentIndex: number;
  clockStartedAtMs: number | null;
  clockDeadlineAtMs: number | null;
  serverClockOffsetMs: number;
  isFlagged: boolean;
  isReviewMode?: boolean;
  questionCount: number;
  showClues: boolean;
  annotationTool: AnnotationTool | null;
  annotationLoading: boolean;
  annotationSaving: boolean;
  canUndoAnnotation: boolean;
  canRedoAnnotation: boolean;
  isFullscreen: boolean;
  onSuspend: () => void;
  onEndBlock: () => void;
  onNext: () => void;
  onPrev: () => void;
  onToggleClues: () => void;
  onToggleFlag: () => void;
  onAnnotationToolChange: (tool: AnnotationTool | null) => void;
  onUndoAnnotation: () => void;
  onRedoAnnotation: () => void;
  onClearAnnotations: () => void;
  onToggleFullscreen: () => void;
}

type CalcOperator = '+' | '-' | '×' | '÷';
type OpenPanel = 'marker' | 'reference' | 'calculator' | null;

const LazyExamReferenceRanges = dynamic(
  () => import('@/components/exam/ExamReferenceRanges').then((module) => module.ExamReferenceRanges),
  {
    ssr: false,
    loading: () => <div className="min-w-[520px] py-6 text-center text-[11px] text-[#aeb6bc]">Loading reference ranges…</div>,
  },
);

const COLOR_SWATCHES: readonly { color: AnnotationColor; label: string; hex: string }[] = [
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

function MiniCalculator() {
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

function ToolButton({
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

export function ExamHeader({
  currentIndex,
  clockStartedAtMs,
  clockDeadlineAtMs,
  serverClockOffsetMs,
  isFlagged,
  isReviewMode = false,
  questionCount,
  showClues,
  annotationTool,
  annotationLoading,
  annotationSaving,
  canUndoAnnotation,
  canRedoAnnotation,
  isFullscreen,
  onSuspend,
  onEndBlock,
  onNext,
  onPrev,
  onToggleClues,
  onToggleFlag,
  onAnnotationToolChange,
  onUndoAnnotation,
  onRedoAnnotation,
  onClearAnnotations,
  onToggleFullscreen,
}: ExamHeaderProps) {
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const [annotationColor, setAnnotationColor] = useState<AnnotationColor>(DEFAULT_ANNOTATION_COLOR);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenPanel(null);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(ANNOTATION_COLOR_STORAGE_KEY);
      if (isAnnotationColor(saved)) setAnnotationColor(saved);
    } catch {
      // Local preference only. Yellow remains the default if storage is unavailable.
    }
  }, []);

  const togglePanel = (panel: Exclude<OpenPanel, null>) => {
    setOpenPanel((current) => (current === panel ? null : panel));
  };

  const chooseAnnotationTool = (tool: AnnotationTool) => {
    onAnnotationToolChange(tool);
  };

  const chooseAnnotationColor = (color: AnnotationColor) => {
    setAnnotationColor(color);
    try {
      window.localStorage.setItem(ANNOTATION_COLOR_STORAGE_KEY, color);
    } catch {
      // The active page still uses the selected color even if storage is blocked.
    }
  };

  return (
    <header className="relative z-[70] shrink-0 overflow-visible border-b border-[#3f4348] bg-[#282828] px-3 py-2 text-white">
      <div className="mx-auto grid max-w-[1240px] grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="flex items-end gap-[3px]">
              <span className="h-[14px] w-[5px] bg-[#ff2020]" />
              <span className="h-[18px] w-[5px] bg-[#fff100]" />
              <span className="h-[23px] w-[5px] bg-[#47d41f]" />
            </div>
            <span className="text-[15px] font-semibold tracking-[-0.2px] text-[#f5f5f5]">RoyalBank</span>
          </div>
          {isReviewMode ? (
            <span className="hidden items-center gap-1.5 rounded-full border border-[#745b91] bg-[#3a3045] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#d9b7ff] md:inline-flex">
              <Eye className="h-3 w-3" /> Completed review
            </span>
          ) : null}
        </div>

        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={onPrev}
            disabled={currentIndex === 0}
            className="flex h-[28px] w-[28px] items-center justify-center rounded-full bg-[#2f80ff] text-white disabled:cursor-not-allowed disabled:opacity-35"
            title="Previous question"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <div className="min-w-[132px] text-center text-[14px] font-semibold text-[#f4f4f4]">
            Question {currentIndex + 1} of {questionCount || 1}
          </div>
          <button
            type="button"
            onClick={onNext}
            disabled={currentIndex >= questionCount - 1}
            className="flex h-[28px] w-[28px] items-center justify-center rounded-full bg-[#2f80ff] text-white disabled:cursor-not-allowed disabled:opacity-35"
            title="Next question"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onSuspend} className="text-[12px] text-[#cf95ff] hover:text-white">
            {isReviewMode ? 'Exit review' : 'Suspend'}
          </button>
          {!isReviewMode ? (
            <button type="button" onClick={onEndBlock} className="text-[12px] text-[#cf95ff] hover:text-white">
              End block
            </button>
          ) : null}
        </div>
      </div>

      <div className="mx-auto mt-2 flex max-w-[1240px] flex-wrap items-center gap-2 overflow-visible border-t border-[#3f4348] pt-2">
        <div className="relative shrink-0">
          <ToolButton
            active={Boolean(annotationTool) || openPanel === 'marker'}
            disabled={annotationLoading}
            onClick={() => togglePanel('marker')}
            title="Marker tools"
          >
            <Pencil className="h-3.5 w-3.5" />
            <span>{annotationTool ? `Marker: ${annotationTool}` : 'Marker'}</span>
            <ChevronDown className="h-3 w-3" />
          </ToolButton>

          {openPanel === 'marker' ? (
            <div className="absolute left-0 top-[36px] z-[90] w-[250px] rounded-[6px] border border-[#5a6066] bg-[#30363b] p-2 shadow-2xl">
              <div className="grid grid-cols-3 gap-1.5">
                <button type="button" onClick={() => chooseAnnotationTool('pencil')} className={`flex flex-col items-center gap-1 rounded px-2 py-2 text-[11px] ${annotationTool === 'pencil' ? 'bg-[#57502b] text-[#fff0a3]' : 'bg-[#3b4248] hover:bg-[#464e55]'}`}><Pencil className="h-4 w-4" />Pencil</button>
                <button type="button" onClick={() => chooseAnnotationTool('highlighter')} className={`flex flex-col items-center gap-1 rounded px-2 py-2 text-[11px] ${annotationTool === 'highlighter' ? 'bg-[#57502b] text-[#fff0a3]' : 'bg-[#3b4248] hover:bg-[#464e55]'}`}><Highlighter className="h-4 w-4" />Highlight</button>
                <button type="button" onClick={() => chooseAnnotationTool('eraser')} className={`flex flex-col items-center gap-1 rounded px-2 py-2 text-[11px] ${annotationTool === 'eraser' ? 'bg-[#57502b] text-[#fff0a3]' : 'bg-[#3b4248] hover:bg-[#464e55]'}`}><Eraser className="h-4 w-4" />Eraser</button>
              </div>

              <div className="mt-2 border-t border-[#4c5359] pt-2">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9fa6ac]">Color</div>
                <div className="flex items-center gap-2">
                  {COLOR_SWATCHES.map((swatch) => (
                    <button
                      key={swatch.color}
                      type="button"
                      onClick={() => chooseAnnotationColor(swatch.color)}
                      aria-label={`${swatch.label} annotation color`}
                      title={swatch.label}
                      className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${
                        annotationColor === swatch.color
                          ? 'border-white ring-2 ring-[#8a9095] ring-offset-1 ring-offset-[#30363b]'
                          : 'border-[#6c7379]'
                      }`}
                      style={{ backgroundColor: swatch.hex }}
                    />
                  ))}
                </div>
              </div>

              <div className="mt-2 grid grid-cols-3 gap-1.5 border-t border-[#4c5359] pt-2">
                <button type="button" disabled={!canUndoAnnotation} onClick={onUndoAnnotation} className="flex items-center justify-center gap-1 rounded bg-[#3b4248] px-2 py-2 text-[11px] disabled:opacity-35"><Undo2 className="h-3.5 w-3.5" />Undo</button>
                <button type="button" disabled={!canRedoAnnotation} onClick={onRedoAnnotation} className="flex items-center justify-center gap-1 rounded bg-[#3b4248] px-2 py-2 text-[11px] disabled:opacity-35"><Redo2 className="h-3.5 w-3.5" />Redo</button>
                <button type="button" onClick={onClearAnnotations} className="flex items-center justify-center gap-1 rounded bg-[#543334] px-2 py-2 text-[11px] text-[#ffd6d6] hover:bg-[#603b3c]"><Trash2 className="h-3.5 w-3.5" />Clear</button>
              </div>
            </div>
          ) : null}
        </div>

        <ToolButton active={isFullscreen} onClick={onToggleFullscreen} title="Toggle full screen">
          {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          <span>Full screen</span>
        </ToolButton>

        <ToolButton active={isFlagged} onClick={onToggleFlag} title="Flag question">
          <Flag className={`h-3.5 w-3.5 ${isFlagged ? 'fill-current' : ''}`} />
          <span>{isFlagged ? 'Flagged' : 'Flag'}</span>
        </ToolButton>

        <ToolButton
          disabled={!annotationTool}
          onClick={() => onAnnotationToolChange(null)}
          title="Exit marker mode and restore normal question controls"
        >
          <MousePointer2 className="h-3.5 w-3.5" />
          <span>Exit marker</span>
        </ToolButton>

        <div className="relative shrink-0">
          <ToolButton active={openPanel === 'reference'} onClick={() => togglePanel('reference')} title="Reference ranges">
            <span>Reference ranges</span>
            <ChevronDown className="h-3 w-3" />
          </ToolButton>
          {openPanel === 'reference' ? (
            <div className="absolute left-0 top-[36px] z-[90] rounded-[6px] border border-[#5a6066] bg-[#30363b] p-4 shadow-2xl">
              <LazyExamReferenceRanges />
              <button type="button" onClick={() => setOpenPanel(null)} className="mt-3 rounded border border-[#5b6268] px-3 py-1.5 text-[#e7e7e7] hover:bg-[#3d444a]">Close</button>
            </div>
          ) : null}
        </div>

        <div className="relative shrink-0">
          <ToolButton active={openPanel === 'calculator'} onClick={() => togglePanel('calculator')} title="Calculator">
            <Calculator className="h-3.5 w-3.5" />
            <span>Calculator</span>
          </ToolButton>
          {openPanel === 'calculator' ? (
            <div className="absolute left-0 top-[36px] z-[90] rounded-[6px] border border-[#5a6066] bg-[#30363b] p-3 shadow-2xl">
              <MiniCalculator />
              <button type="button" onClick={() => setOpenPanel(null)} className="mt-3 w-full rounded border border-[#5b6268] py-1.5 text-[11px] text-[#e7e7e7] hover:bg-[#3d444a]">Close calculator</button>
            </div>
          ) : null}
        </div>

        <ToolButton active={showClues} onClick={onToggleClues} title="Toggle clues">
          <Lightbulb className={`h-3.5 w-3.5 ${showClues ? 'fill-current' : ''}`} />
          <span>{showClues ? 'Clues on' : 'Clues'}</span>
        </ToolButton>

        {isReviewMode ? (
          <div className="inline-flex h-[30px] shrink-0 items-center gap-2 rounded-[4px] border border-[#745b91] bg-[#3a3045] px-3 text-[12px] text-[#d9b7ff]">
            <Eye className="h-3.5 w-3.5" />
            <span>Read only</span>
          </div>
        ) : (
          <ExamClock
            startedAtMs={clockStartedAtMs}
            deadlineAtMs={clockDeadlineAtMs}
            serverClockOffsetMs={serverClockOffsetMs}
          />
        )}

        <div className="ml-auto shrink-0 px-1 text-[10px] text-[#92999f]">
          {annotationLoading ? 'Loading marks…' : annotationSaving ? 'Saving marks…' : 'Marks saved'}
        </div>
      </div>
    </header>
  );
}

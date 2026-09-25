'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Calculator,
  ChevronDown,
  Eraser,
  Eye,
  Flag,
  Highlighter,
  Lightbulb,
  Maximize2,
  Minimize2,
  Pause,
  Pencil,
  Redo2,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { ExamClock } from '@/components/exam/ExamClock';
import {
  COLOR_SWATCHES,
  ExamMobileHeader,
  MiniCalculator,
  MobileToolTile,
  ToolButton,
} from '@/components/exam/ExamHeaderParts';
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

type OpenPanel = 'marker' | 'reference' | 'calculator' | null;

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
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [annotationColor, setAnnotationColor] = useState<AnnotationColor>(DEFAULT_ANNOTATION_COLOR);
  const [lastDrawingTool, setLastDrawingTool] = useState<Extract<AnnotationTool, 'pencil' | 'highlighter'>>('pencil');

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenPanel(null);
        setMobileToolsOpen(false);
      }
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
    if (tool === 'pencil' || tool === 'highlighter') setLastDrawingTool(tool);
    onAnnotationToolChange(tool);
  };

  const toggleMarkerMode = () => {
    if (annotationTool) {
      onAnnotationToolChange(null);
    } else {
      onAnnotationToolChange(lastDrawingTool);
    }
  };

  const chooseAnnotationColor = (color: AnnotationColor) => {
    setAnnotationColor(color);
    try {
      window.localStorage.setItem(ANNOTATION_COLOR_STORAGE_KEY, color);
    } catch {
      // The active page still uses the selected color even if storage is blocked.
    }
  };

  const closeMobileTools = () => {
    setOpenPanel(null);
    setMobileToolsOpen(false);
  };

  return (
    <>
      <ExamMobileHeader
        currentIndex={currentIndex}
        questionCount={questionCount}
        isFlagged={isFlagged}
        isReviewMode={isReviewMode}
        clockStartedAtMs={clockStartedAtMs}
        clockDeadlineAtMs={clockDeadlineAtMs}
        serverClockOffsetMs={serverClockOffsetMs}
        showClues={showClues}
        onToggleFlag={onToggleFlag}
        onEndBlock={onEndBlock}
        onToggleClues={onToggleClues}
        onOpenTools={() => {
          setOpenPanel(null);
          setMobileToolsOpen(true);
        }}
      />

      {mobileToolsOpen ? (
        <div className="fixed inset-0 z-[190] flex items-end bg-black/45 md:hidden" role="dialog" aria-modal="true" aria-label="Exam tools">
          <button
            type="button"
            aria-label="Close exam tools"
            className="absolute inset-0"
            onClick={closeMobileTools}
          />
          <div className="relative z-[1] max-h-[82dvh] w-full overflow-y-auto rounded-t-[22px] border-t border-[#e0d4c0] bg-[#fffdfa] px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3 text-[#10243f] shadow-[0_-18px_45px_rgba(0,0,0,0.2)] dark:border-[#4c5359] dark:bg-[#242a2f] dark:text-white">
            <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-[#c8c0b4] dark:bg-[#596168]" />
            <div className="flex items-center justify-between">
              <h2 className="text-[18px] font-semibold">Tools</h2>
              <button
                type="button"
                onClick={closeMobileTools}
                className="grid h-9 w-9 place-items-center rounded-full bg-[#f4ede2] text-[#8f6b31] dark:bg-[#343b41] dark:text-[#d9dce0]"
                aria-label="Close tools"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <MobileToolTile
                active={openPanel === 'marker' || Boolean(annotationTool)}
                onClick={() => togglePanel('marker')}
                icon={<Pencil className="h-5 w-5" />}
                label="Marker"
              />
              <MobileToolTile
                active={openPanel === 'reference'}
                onClick={() => togglePanel('reference')}
                icon={<BookOpen className="h-5 w-5" />}
                label="Reference ranges"
              />
              <MobileToolTile
                active={openPanel === 'calculator'}
                onClick={() => togglePanel('calculator')}
                icon={<Calculator className="h-5 w-5" />}
                label="Calculator"
              />
              <MobileToolTile
                active={isFullscreen}
                onClick={() => {
                  void onToggleFullscreen();
                  closeMobileTools();
                }}
                icon={isFullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
                label={isFullscreen ? 'Exit full screen' : 'Full screen'}
              />
              <MobileToolTile
                onClick={() => {
                  closeMobileTools();
                  onSuspend();
                }}
                icon={<Pause className="h-5 w-5" />}
                label={isReviewMode ? 'Exit review' : 'Suspend'}
                wide
              />
            </div>

            {openPanel === 'marker' ? (
              <div className="mt-4 rounded-[12px] border border-[#e1d5c2] bg-[#fbf7ef] p-3 dark:border-[#4c5359] dark:bg-[#30363b]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7c8795] dark:text-[#9fa6ac]">Marker tools</span>
                  <button
                    type="button"
                    onClick={toggleMarkerMode}
                    disabled={annotationLoading}
                    className={`rounded-full border px-3 py-1 text-[10px] font-semibold ${
                      annotationTool
                        ? 'border-[#b88a32] bg-[#f4ead7] text-[#8f6522] dark:border-[#d5ad5c] dark:bg-[#4d4023] dark:text-[#fff0a3]'
                        : 'border-[#d6c8b1] text-[#6b7280] dark:border-[#596168] dark:text-[#b9c0c6]'
                    }`}
                  >
                    {annotationTool ? 'Marker on' : 'Marker off'}
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  {([
                    ['pencil', 'Pencil', <Pencil key="pencil-icon" className="h-4 w-4" />],
                    ['highlighter', 'Highlight', <Highlighter key="highlight-icon" className="h-4 w-4" />],
                    ['eraser', 'Eraser', <Eraser key="eraser-icon" className="h-4 w-4" />],
                  ] as const).map(([tool, label, icon]) => (
                    <button
                      key={tool}
                      type="button"
                      onClick={() => chooseAnnotationTool(tool)}
                      className={`flex min-h-[54px] flex-col items-center justify-center gap-1 rounded-[9px] border text-[10px] font-semibold ${
                        annotationTool === tool
                          ? 'border-[#b88a32] bg-[#f4ead7] text-[#8f6522] dark:border-[#d5ad5c] dark:bg-[#4d4023] dark:text-[#fff0a3]'
                          : 'border-[#ded2bf] bg-white text-[#10243f] dark:border-[#596168] dark:bg-[#394046] dark:text-white'
                      }`}
                    >
                      {icon}
                      {label}
                    </button>
                  ))}
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {COLOR_SWATCHES.map((swatch) => (
                      <button
                        key={swatch.color}
                        type="button"
                        onClick={() => chooseAnnotationColor(swatch.color)}
                        aria-label={`${swatch.label} annotation color`}
                        className={`h-7 w-7 rounded-full border-2 ${
                          annotationColor === swatch.color
                            ? 'border-[#10243f] ring-2 ring-[#c4b28f] dark:border-white'
                            : 'border-[#d4c8b6] dark:border-[#6c7379]'
                        }`}
                        style={{ backgroundColor: swatch.hex }}
                      />
                    ))}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <button type="button" disabled={!canUndoAnnotation} onClick={onUndoAnnotation} className="inline-flex h-9 items-center justify-center gap-1 rounded-[8px] border border-[#ded2bf] text-[10px] disabled:opacity-35 dark:border-[#596168]"><Undo2 className="h-3.5 w-3.5" />Undo</button>
                  <button type="button" disabled={!canRedoAnnotation} onClick={onRedoAnnotation} className="inline-flex h-9 items-center justify-center gap-1 rounded-[8px] border border-[#ded2bf] text-[10px] disabled:opacity-35 dark:border-[#596168]"><Redo2 className="h-3.5 w-3.5" />Redo</button>
                  <button type="button" onClick={onClearAnnotations} className="inline-flex h-9 items-center justify-center gap-1 rounded-[8px] border border-[#e0b6b2] text-[10px] text-[#a44139] dark:border-[#6a4545] dark:text-[#ffd6d6]"><Trash2 className="h-3.5 w-3.5" />Clear</button>
                </div>
              </div>
            ) : null}

            {openPanel === 'reference' ? (
              <div className="mt-4 overflow-hidden rounded-[12px] border border-[#e1d5c2] bg-[#fbf7ef] p-3 dark:border-[#4c5359] dark:bg-[#30363b]">
                <LazyExamReferenceRanges />
              </div>
            ) : null}

            {openPanel === 'calculator' ? (
              <div className="mt-4 flex justify-center rounded-[12px] border border-[#e1d5c2] bg-[#fbf7ef] p-3 dark:border-[#4c5359] dark:bg-[#30363b]">
                <MiniCalculator />
              </div>
            ) : null}

            <p className="mt-3 text-center text-[9px] text-[#8b95a1] dark:text-[#92999f]">
              {annotationLoading ? 'Loading marks…' : annotationSaving ? 'Saving marks…' : 'Marks saved'}
            </p>
          </div>
        </div>
      ) : null}

      <header className="relative z-[70] hidden shrink-0 overflow-visible border-b border-[#3f4348] bg-[#282828] px-3 py-2 text-white md:block">
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
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => togglePanel('reference')}
              className={`inline-flex items-center gap-1 text-[12px] transition-colors ${
                openPanel === 'reference' ? 'text-white' : 'text-[#cf95ff] hover:text-white'
              }`}
              title="Reference ranges"
            >
              <span>Reference ranges</span>
              <ChevronDown className="h-3 w-3" />
            </button>
            {openPanel === 'reference' ? (
              <div className="absolute right-0 top-[28px] z-[100] max-w-[calc(100vw-2rem)] rounded-[6px] border border-[#5a6066] bg-[#30363b] p-4 shadow-2xl">
                <LazyExamReferenceRanges />
                <button
                  type="button"
                  onClick={() => setOpenPanel(null)}
                  className="mt-3 rounded border border-[#5b6268] px-3 py-1.5 text-[#e7e7e7] hover:bg-[#3d444a]"
                >
                  Close
                </button>
              </div>
            ) : null}
          </div>
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

      <div className="relative mx-auto mt-2 max-w-[1240px] overflow-visible border-t border-[#3f4348] pt-2">
        <div className="flex flex-wrap items-center justify-center gap-2 overflow-visible">
          <div className="relative shrink-0">
            <ToolButton
              active={Boolean(annotationTool) || openPanel === 'marker'}
              disabled={annotationLoading}
              onClick={() => togglePanel('marker')}
              title="Marker tools"
            >
              <Pencil className="h-3.5 w-3.5" />
              <span>
                {annotationTool === 'highlighter'
                  ? 'Marker: Highlight'
                  : annotationTool === 'pencil'
                    ? 'Marker: Pencil'
                    : annotationTool === 'eraser'
                      ? 'Marker: Eraser'
                      : 'Marker'}
              </span>
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

          <button
            type="button"
            role="switch"
            aria-checked={Boolean(annotationTool)}
            onClick={toggleMarkerMode}
            disabled={annotationLoading}
            title={annotationTool ? 'Turn marker mode off' : `Turn ${lastDrawingTool} mode on`}
            className={`inline-flex h-[30px] shrink-0 items-center gap-2 rounded-full border px-2.5 text-[10px] font-semibold transition-colors disabled:opacity-35 ${
              annotationTool
                ? 'border-[#e5c64b] bg-[#514718] text-[#fff0a3]'
                : 'border-[#5a5f64] bg-[#33383c] text-[#b9c0c6]'
            }`}
          >
            <span
              className={`relative h-[16px] w-[28px] rounded-full transition-colors ${
                annotationTool ? 'bg-[#d9bd42]' : 'bg-[#555d64]'
              }`}
            >
              <span
                className={`absolute top-[2px] h-[12px] w-[12px] rounded-full bg-white transition-transform ${
                  annotationTool ? 'translate-x-[14px]' : 'translate-x-[2px]'
                }`}
              />
            </span>
            <span>{annotationTool ? 'On' : 'Off'}</span>
          </button>

          <ToolButton active={isFullscreen} onClick={onToggleFullscreen} title="Toggle full screen">
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            <span>Full screen</span>
          </ToolButton>

          <ToolButton active={isFlagged} onClick={onToggleFlag} title="Flag question">
            <Flag className={`h-3.5 w-3.5 ${isFlagged ? 'fill-current' : ''}`} />
            <span>{isFlagged ? 'Flagged' : 'Flag'}</span>
          </ToolButton>

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

          <div className="relative shrink-0">
            <ToolButton active={openPanel === 'calculator'} onClick={() => togglePanel('calculator')} title="Calculator">
              <Calculator className="h-3.5 w-3.5" />
              <span>Calculator</span>
            </ToolButton>
            {openPanel === 'calculator' ? (
              <div className="absolute right-0 top-[36px] z-[90] rounded-[6px] border border-[#5a6066] bg-[#30363b] p-3 shadow-2xl">
                <MiniCalculator />
                <button type="button" onClick={() => setOpenPanel(null)} className="mt-3 w-full rounded border border-[#5b6268] py-1.5 text-[11px] text-[#e7e7e7] hover:bg-[#3d444a]">Close calculator</button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="pointer-events-none absolute right-1 top-[12px] hidden shrink-0 text-[10px] text-[#92999f] 2xl:block">
          {annotationLoading ? 'Loading marks…' : annotationSaving ? 'Saving marks…' : 'Marks saved'}
        </div>
      </div>
    </header>
    </>
  );
}

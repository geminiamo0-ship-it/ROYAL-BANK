'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ANNOTATION_COLOR_STORAGE_KEY,
  DEFAULT_ANNOTATION_COLOR,
  createAnnotationStrokeId,
  distanceToStroke,
  isAnnotationColor,
  isInkAnnotationStroke,
  isTextHighlight,
  sha256Hex,
  simplifyAnnotationPoints,
  type AnnotationColor,
  type AnnotationInkStroke,
  type AnnotationPoint,
  type AnnotationStroke,
  type AnnotationSurface,
  type AnnotationTextHighlight,
  type AnnotationTool,
  type StoredQuestionAnnotation,
} from '@/lib/exam-annotations';
import {
  contentRootFor,
  rangeForHighlight,
  selectedTextOffsets,
} from '@/lib/exam-annotation-text-ranges';

interface ExamAnnotationLayerProps {
  surface: AnnotationSurface;
  contentFingerprint: string;
  tool: AnnotationTool | null;
  record?: StoredQuestionAnnotation;
  onAppendStroke: (
    surface: AnnotationSurface,
    contentHash: string,
    stroke: AnnotationStroke,
  ) => void;
  onEraseStroke: (
    surface: AnnotationSurface,
    contentHash: string,
    strokeId: string,
  ) => void;
  onUpdateStroke: (
    surface: AnnotationSurface,
    contentHash: string,
    stroke: AnnotationStroke,
  ) => void;
}

interface TouchScrollState {
  pointerId: number;
  lastY: number;
  scrollElement: HTMLElement | null;
}

interface HighlightRect {
  key: string;
  markId: string;
  left: number;
  top: number;
  width: number;
  height: number;
  color: AnnotationColor;
}

interface HighlightMenuState {
  markId: string;
  left: number;
  top: number;
}

const PENCIL_COLORS: Record<AnnotationColor, string> = {
  yellow: '#ffd84d',
  red: '#ff4d5a',
  blue: '#4da3ff',
  green: '#55d66b',
  purple: '#b27cff',
};

const HIGHLIGHTER_COLORS: Record<AnnotationColor, string> = {
  yellow: 'rgba(255, 226, 94, 0.42)',
  red: 'rgba(255, 77, 90, 0.36)',
  blue: 'rgba(77, 163, 255, 0.36)',
  green: 'rgba(85, 214, 107, 0.36)',
  purple: 'rgba(178, 124, 255, 0.36)',
};

const HIGHLIGHT_MENU_COLORS: readonly AnnotationColor[] = [
  'yellow',
  'red',
  'blue',
  'green',
  'purple',
];

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function canDrawWithPointer(event: React.PointerEvent<SVGSVGElement>): boolean {
  if (event.pointerType === 'touch') return false;
  if (event.pointerType === 'mouse') return event.button === 0;
  if (event.pointerType === 'pen') return event.button === 0 || event.button === 5;
  return event.button === 0;
}

function findVerticalScrollContainer(element: Element): HTMLElement | null {
  let current = element.parentElement;

  while (current) {
    const style = window.getComputedStyle(current);
    const canScrollVertically = /(auto|scroll|overlay)/.test(style.overflowY);
    if (canScrollVertically && current.scrollHeight > current.clientHeight) return current;
    current = current.parentElement;
  }

  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
}

function pointFromClient(target: SVGSVGElement, clientX: number, clientY: number): AnnotationPoint {
  const rect = target.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return [0, 0];
  return [
    clampUnit((clientX - rect.left) / rect.width),
    clampUnit((clientY - rect.top) / rect.height),
  ];
}

function readPreferredAnnotationColor(): AnnotationColor {
  try {
    const saved = window.localStorage.getItem(ANNOTATION_COLOR_STORAGE_KEY);
    return isAnnotationColor(saved) ? saved : DEFAULT_ANNOTATION_COLOR;
  } catch {
    return DEFAULT_ANNOTATION_COLOR;
  }
}

function pencilPath(points: AnnotationPoint[]): string {
  if (points.length === 0) return '';
  const scaled = points.map(([x, y]) => [x * 1000, y * 1000] as const);
  if (scaled.length === 1) return `M ${scaled[0][0]} ${scaled[0][1]}`;
  if (scaled.length === 2) {
    return `M ${scaled[0][0]} ${scaled[0][1]} L ${scaled[1][0]} ${scaled[1][1]}`;
  }

  let path = `M ${scaled[0][0]} ${scaled[0][1]}`;
  for (let index = 1; index < scaled.length - 2; index += 1) {
    const current = scaled[index];
    const next = scaled[index + 1];
    const midX = (current[0] + next[0]) / 2;
    const midY = (current[1] + next[1]) / 2;
    path += ` Q ${current[0]} ${current[1]} ${midX} ${midY}`;
  }

  const control = scaled[scaled.length - 2];
  const end = scaled[scaled.length - 1];
  path += ` Q ${control[0]} ${control[1]} ${end[0]} ${end[1]}`;
  return path;
}

export function ExamAnnotationLayer({
  surface,
  contentFingerprint,
  tool,
  record,
  onAppendStroke,
  onEraseStroke,
  onUpdateStroke,
}: ExamAnnotationLayerProps) {
  const [contentHash, setContentHash] = useState<string | null>(null);
  const [inProgress, setInProgress] = useState<AnnotationInkStroke | null>(null);
  const [highlightRects, setHighlightRects] = useState<HighlightRect[]>([]);
  const [highlightMenu, setHighlightMenu] = useState<HighlightMenuState | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const inProgressRef = useRef<AnnotationInkStroke | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const touchScrollRef = useRef<TouchScrollState | null>(null);
  const erasedStrokeIdsRef = useRef(new Set<string>());
  const selectionTimerRef = useRef<number | null>(null);
  const longPressRef = useRef<{
    timer: number;
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContentHash(null);
    sha256Hex(contentFingerprint)
      .then((hash) => {
        if (!cancelled) setContentHash(hash);
      })
      .catch(() => {
        if (!cancelled) setContentHash(null);
      });
    return () => {
      cancelled = true;
    };
  }, [contentFingerprint]);

  useEffect(() => {
    if (tool) return;
    pointerIdRef.current = null;
    touchScrollRef.current = null;
    inProgressRef.current = null;
    setInProgress(null);
    setHighlightMenu(null);
    erasedStrokeIdsRef.current.clear();
  }, [tool]);

  const visibleMarks = useMemo<AnnotationStroke[]>(
    () => (contentHash && record?.contentHash === contentHash ? record.strokes : []),
    [contentHash, record],
  );
  const textHighlights = useMemo(
    () => visibleMarks.filter(isTextHighlight),
    [visibleMarks],
  );
  const visibleInk = useMemo(
    () => visibleMarks.filter(isInkAnnotationStroke),
    [visibleMarks],
  );
  const hasStaleRecord = Boolean(contentHash && record && record.contentHash !== contentHash && record.strokes.length > 0);
  const strictInkMode = tool === 'pencil' || tool === 'eraser';

  const rebuildHighlightRects = useCallback(() => {
    const layer = layerRef.current;
    const parent = layer?.parentElement;
    const root = contentRootFor(layer);
    if (!layer || !parent || !root || !contentHash) {
      setHighlightRects([]);
      return;
    }

    const parentRect = parent.getBoundingClientRect();
    const next: HighlightRect[] = [];

    for (const mark of textHighlights) {
      const range = rangeForHighlight(root, mark);
      if (!range) continue;

      [...range.getClientRects()].forEach((rect, index) => {
        if (rect.width <= 0 || rect.height <= 0) return;
        next.push({
          key: `${mark.id}:${index}`,
          markId: mark.id,
          left: rect.left - parentRect.left,
          top: rect.top - parentRect.top,
          width: rect.width,
          height: rect.height,
          color: mark.color || DEFAULT_ANNOTATION_COLOR,
        });
      });
    }

    setHighlightRects(next);
  }, [contentHash, textHighlights]);

  useEffect(() => {
    const root = contentRootFor(layerRef.current);
    const parent = layerRef.current?.parentElement;
    if (!root || !parent) {
      setHighlightRects([]);
      return;
    }

    const frame = window.requestAnimationFrame(rebuildHighlightRects);
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(rebuildHighlightRects)
      : null;
    observer?.observe(root);
    observer?.observe(parent);
    window.addEventListener('resize', rebuildHighlightRects);

    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', rebuildHighlightRects);
    };
  }, [rebuildHighlightRects]);

  const commitTextSelection = useCallback(() => {
    if (tool !== 'highlighter' || !contentHash) return;
    const root = contentRootFor(layerRef.current);
    if (!root) return;

    const selected = selectedTextOffsets(root);
    if (!selected) return;

    const mark: AnnotationTextHighlight = {
      id: createAnnotationStrokeId(),
      tool: 'text-highlight',
      start: selected.start,
      end: selected.end,
      color: readPreferredAnnotationColor(),
      quote: selected.quote,
    };

    onAppendStroke(surface, contentHash, mark);
    window.getSelection()?.removeAllRanges();
    setHighlightMenu(null);
  }, [contentHash, onAppendStroke, surface, tool]);

  useEffect(() => {
    if (tool !== 'highlighter') return;

    const scheduleFromSelection = () => {
      if (selectionTimerRef.current != null) window.clearTimeout(selectionTimerRef.current);
      selectionTimerRef.current = window.setTimeout(() => {
        selectionTimerRef.current = null;
        commitTextSelection();
      }, 650);
    };

    const finishPointerSelection = (event: PointerEvent) => {
      const root = contentRootFor(layerRef.current);
      if (!root || !(event.target instanceof Node) || !root.contains(event.target)) return;
      if (selectionTimerRef.current != null) window.clearTimeout(selectionTimerRef.current);
      selectionTimerRef.current = window.setTimeout(() => {
        selectionTimerRef.current = null;
        commitTextSelection();
      }, event.pointerType === 'touch' ? 180 : 20);
    };

    document.addEventListener('selectionchange', scheduleFromSelection);
    document.addEventListener('pointerup', finishPointerSelection, true);
    return () => {
      document.removeEventListener('selectionchange', scheduleFromSelection);
      document.removeEventListener('pointerup', finishPointerSelection, true);
      if (selectionTimerRef.current != null) window.clearTimeout(selectionTimerRef.current);
      selectionTimerRef.current = null;
    };
  }, [commitTextSelection, tool]);

  const toPoint = useCallback((event: React.PointerEvent<SVGSVGElement>): AnnotationPoint => (
    pointFromClient(event.currentTarget, event.clientX, event.clientY)
  ), []);

  const eraseAt = useCallback((point: AnnotationPoint, target: SVGSVGElement) => {
    if (!contentHash) return;
    const rect = target.getBoundingClientRect();
    const threshold = Math.max(0.009, 14 / Math.max(1, Math.min(rect.width, rect.height)));

    const hit = [...visibleInk]
      .reverse()
      .find((stroke) => (
        !erasedStrokeIdsRef.current.has(stroke.id)
        && distanceToStroke(point, stroke) <= threshold
      ));

    if (!hit) return;
    erasedStrokeIdsRef.current.add(hit.id);
    onEraseStroke(surface, contentHash, hit.id);
  }, [contentHash, onEraseStroke, surface, visibleInk]);

  const handlePointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!tool || tool === 'highlighter' || !contentHash) return;

    if (event.pointerType === 'touch') {
      if (!strictInkMode) return;

      event.preventDefault();
      const scrollElement = findVerticalScrollContainer(event.currentTarget);
      touchScrollRef.current = {
        pointerId: event.pointerId,
        lastY: event.clientY,
        scrollElement,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (!canDrawWithPointer(event)) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerIdRef.current = event.pointerId;
    const point = toPoint(event);

    if (tool === 'eraser') {
      erasedStrokeIdsRef.current.clear();
      eraseAt(point, event.currentTarget);
      return;
    }

    const stroke: AnnotationInkStroke = {
      id: createAnnotationStrokeId(),
      tool: 'pencil',
      width: 2.5,
      points: [point],
      color: readPreferredAnnotationColor(),
    };
    inProgressRef.current = stroke;
    setInProgress(stroke);
  }, [contentHash, eraseAt, strictInkMode, toPoint, tool]);

  const handlePointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (event.pointerType === 'touch') {
      const touchScroll = touchScrollRef.current;
      if (!touchScroll || touchScroll.pointerId !== event.pointerId) return;

      event.preventDefault();
      const deltaY = touchScroll.lastY - event.clientY;
      touchScroll.lastY = event.clientY;
      if (touchScroll.scrollElement && deltaY !== 0) {
        touchScroll.scrollElement.scrollTop += deltaY;
      }
      return;
    }

    if (!tool || tool === 'highlighter' || pointerIdRef.current !== event.pointerId) return;
    event.preventDefault();

    if (tool === 'eraser') {
      eraseAt(toPoint(event), event.currentTarget);
      return;
    }

    const current = inProgressRef.current;
    if (!current || current.points.length >= 2000) return;

    const nativeEvent = event.nativeEvent;
    const samples = typeof nativeEvent.getCoalescedEvents === 'function'
      ? nativeEvent.getCoalescedEvents()
      : [nativeEvent];
    const sourceSamples = samples.length > 0 ? samples : [nativeEvent];
    const nextPoints = [...current.points];
    let previous = nextPoints[nextPoints.length - 1];

    for (const sample of sourceSamples) {
      if (nextPoints.length >= 2000) break;
      const point = pointFromClient(event.currentTarget, sample.clientX, sample.clientY);
      if (Math.hypot(point[0] - previous[0], point[1] - previous[1]) < 0.0003) continue;
      nextPoints.push(point);
      previous = point;
    }

    if (nextPoints.length === current.points.length) return;
    const next: AnnotationInkStroke = { ...current, points: nextPoints };
    inProgressRef.current = next;
    setInProgress(next);
  }, [eraseAt, toPoint, tool]);

  const finishStroke = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (event.pointerType === 'touch') {
      const touchScroll = touchScrollRef.current;
      if (!touchScroll || touchScroll.pointerId !== event.pointerId) return;

      event.preventDefault();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      touchScrollRef.current = null;
      return;
    }

    if (pointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerIdRef.current = null;

    if (tool === 'eraser') {
      erasedStrokeIdsRef.current.clear();
      return;
    }

    const current = inProgressRef.current;
    inProgressRef.current = null;
    setInProgress(null);
    if (!current || !contentHash) return;

    let points: AnnotationPoint[] = current.points;
    if (points.length === 1) {
      const [x, y] = points[0];
      points = [[x, y], [clampUnit(x + 0.0001), clampUnit(y + 0.0001)]];
    }

    const simplified = simplifyAnnotationPoints(points, 0.0005).slice(0, 2000);
    onAppendStroke(surface, contentHash, { ...current, points: simplified });
  }, [contentHash, onAppendStroke, surface, tool]);

  const cancelStroke = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (event.pointerType === 'touch') {
      if (touchScrollRef.current?.pointerId === event.pointerId) touchScrollRef.current = null;
      return;
    }

    if (pointerIdRef.current !== event.pointerId) return;
    pointerIdRef.current = null;
    inProgressRef.current = null;
    setInProgress(null);
    erasedStrokeIdsRef.current.clear();
  }, []);

  const openHighlightMenu = useCallback((markId: string, rect: HighlightRect) => {
    const layer = layerRef.current;
    if (!layer) return;
    const width = layer.clientWidth;
    const height = layer.clientHeight;
    setHighlightMenu({
      markId,
      left: Math.max(4, Math.min(width - 190, rect.left)),
      top: Math.max(4, Math.min(height - 48, rect.top + rect.height + 5)),
    });
  }, []);

  const beginHighlightLongPress = useCallback((
    event: React.PointerEvent<HTMLButtonElement>,
    rect: HighlightRect,
  ) => {
    if (event.pointerType !== 'touch') return;
    if (longPressRef.current) window.clearTimeout(longPressRef.current.timer);
    const timer = window.setTimeout(() => {
      openHighlightMenu(rect.markId, rect);
      longPressRef.current = null;
    }, 450);
    longPressRef.current = {
      timer,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  }, [openHighlightMenu]);

  const moveHighlightLongPress = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const state = longPressRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - state.x, event.clientY - state.y) > 8) {
      window.clearTimeout(state.timer);
      longPressRef.current = null;
    }
  }, []);

  const endHighlightLongPress = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const state = longPressRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    window.clearTimeout(state.timer);
    longPressRef.current = null;
  }, []);

  const activeHighlight = highlightMenu
    ? textHighlights.find((mark) => mark.id === highlightMenu.markId) || null
    : null;
  const renderInk = inProgress ? [...visibleInk, inProgress] : visibleInk;

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0 z-20">
      {highlightRects.map((rect) => (
        <button
          key={rect.key}
          type="button"
          tabIndex={tool === 'highlighter' ? 0 : -1}
          aria-label="Edit text highlight"
          className={`absolute rounded-[2px] border-0 p-0 ${tool === 'highlighter' ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'}`}
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            background: HIGHLIGHTER_COLORS[rect.color],
            touchAction: 'pan-y',
          }}
          onClick={() => openHighlightMenu(rect.markId, rect)}
          onPointerDown={(event) => beginHighlightLongPress(event, rect)}
          onPointerMove={moveHighlightLongPress}
          onPointerUp={endHighlightLongPress}
          onPointerCancel={endHighlightLongPress}
        />
      ))}

      {activeHighlight && highlightMenu && contentHash ? (
        <div
          className="pointer-events-auto absolute z-40 flex items-center gap-1.5 rounded-[6px] border border-[#5e666d] bg-[#2f353a] px-2 py-1.5 shadow-2xl"
          style={{ left: highlightMenu.left, top: highlightMenu.top }}
          role="dialog"
          aria-label="Highlight options"
        >
          {HIGHLIGHT_MENU_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Change highlight to ${color}`}
              className={`h-5 w-5 rounded-full border ${(activeHighlight.color || DEFAULT_ANNOTATION_COLOR) === color ? 'border-white ring-1 ring-white/60' : 'border-[#707880]'}`}
              style={{ backgroundColor: PENCIL_COLORS[color] }}
              onClick={() => {
                onUpdateStroke(surface, contentHash, { ...activeHighlight, color });
                setHighlightMenu(null);
              }}
            />
          ))}
          <span className="mx-0.5 h-5 w-px bg-[#555d64]" />
          <button
            type="button"
            className="rounded px-2 py-1 text-[10px] font-semibold text-[#ff9da5] hover:bg-[#53373a]"
            onClick={() => {
              onEraseStroke(surface, contentHash, activeHighlight.id);
              setHighlightMenu(null);
            }}
          >
            Delete
          </button>
        </div>
      ) : null}

      <svg
        className={`absolute inset-0 h-full w-full ${strictInkMode ? 'pointer-events-auto cursor-crosshair' : 'pointer-events-none'}`}
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        style={{ touchAction: strictInkMode ? 'none' : 'auto' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishStroke}
        onPointerCancel={cancelStroke}
      >
        {renderInk.map((stroke) => {
          const strokeColor = stroke.color || DEFAULT_ANNOTATION_COLOR;
          if (stroke.tool === 'pencil') {
            return (
              <path
                key={stroke.id}
                d={pencilPath(stroke.points)}
                fill="none"
                stroke={PENCIL_COLORS[strokeColor]}
                strokeWidth={stroke.width}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            );
          }

          return (
            <polyline
              key={stroke.id}
              points={stroke.points.map(([x, y]) => `${x * 1000},${y * 1000}`).join(' ')}
              fill="none"
              stroke={HIGHLIGHTER_COLORS[strokeColor]}
              strokeWidth={stroke.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>

      {hasStaleRecord ? (
        <div className="pointer-events-none absolute right-2 top-2 z-30 rounded bg-[#453b1f]/95 px-2 py-1 text-[10px] font-medium text-[#ffe9a6] shadow">
          Saved marks hidden: content changed
        </div>
      ) : null}
    </div>
  );
}

'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_ANNOTATION_COLOR,
  createAnnotationStrokeId,
  distanceToStroke,
  sha256Hex,
  simplifyAnnotationPoints,
  type AnnotationColor,
  type AnnotationPoint,
  type AnnotationStroke,
  type AnnotationSurface,
  type AnnotationTool,
  type StoredQuestionAnnotation,
} from '@/lib/exam-annotations';

interface ExamAnnotationLayerProps {
  surface: AnnotationSurface;
  contentFingerprint: string;
  tool: AnnotationTool | null;
  color: AnnotationColor;
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
}

interface TouchScrollState {
  pointerId: number;
  lastY: number;
  scrollElement: HTMLElement | null;
}

const PENCIL_COLORS: Record<AnnotationColor, string> = {
  yellow: '#ffd84d',
  red: '#ff4d5a',
  blue: '#4da3ff',
  green: '#55d66b',
  purple: '#b27cff',
};

const HIGHLIGHTER_COLORS: Record<AnnotationColor, string> = {
  // Keep the original yellow highlighter appearance exactly as before.
  yellow: 'rgba(255, 226, 94, 0.42)',
  red: 'rgba(255, 77, 90, 0.36)',
  blue: 'rgba(77, 163, 255, 0.36)',
  green: 'rgba(85, 214, 107, 0.36)',
  purple: 'rgba(178, 124, 255, 0.36)',
};

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function canDrawWithPointer(event: React.PointerEvent<SVGSVGElement>): boolean {
  // Touch is reserved for scrolling. Pens/styli and the primary mouse button annotate.
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
  color,
  record,
  onAppendStroke,
  onEraseStroke,
}: ExamAnnotationLayerProps) {
  const [contentHash, setContentHash] = useState<string | null>(null);
  const [inProgress, setInProgress] = useState<AnnotationStroke | null>(null);
  const inProgressRef = useRef<AnnotationStroke | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const touchScrollRef = useRef<TouchScrollState | null>(null);
  const erasedStrokeIdsRef = useRef(new Set<string>());

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
    erasedStrokeIdsRef.current.clear();
  }, [tool]);

  const visibleStrokes = contentHash && record?.contentHash === contentHash ? record.strokes : [];
  const hasStaleRecord = Boolean(contentHash && record && record.contentHash !== contentHash && record.strokes.length > 0);
  const strictInkMode = tool === 'pencil' || tool === 'eraser';

  const toPoint = useCallback((event: React.PointerEvent<SVGSVGElement>): AnnotationPoint => (
    pointFromClient(event.currentTarget, event.clientX, event.clientY)
  ), []);

  const eraseAt = useCallback((point: AnnotationPoint, target: SVGSVGElement) => {
    if (!contentHash) return;
    const rect = target.getBoundingClientRect();
    const threshold = Math.max(0.009, 14 / Math.max(1, Math.min(rect.width, rect.height)));

    const hit = [...visibleStrokes]
      .reverse()
      .find((stroke) => (
        !erasedStrokeIdsRef.current.has(stroke.id)
        && distanceToStroke(point, stroke) <= threshold
      ));

    if (!hit) return;
    erasedStrokeIdsRef.current.add(hit.id);
    onEraseStroke(surface, contentHash, hit.id);
  }, [contentHash, onEraseStroke, surface, visibleStrokes]);

  const handlePointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!tool || !contentHash) return;

    // Pencil/Eraser are strict ink modes. CSS touch-action is disabled for these modes
    // so the browser cannot steal a vertical stylus stroke and turn it into scrolling.
    // Finger input is handled separately below and scrolls the nearest exam scroller.
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

    // A pen/mouse drawing pointer is owned by Royal until pointer-up. In strict pencil
    // mode this works together with touch-action:none, so even I/t/l/1 strokes stay ink.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerIdRef.current = event.pointerId;
    const point = toPoint(event);

    if (tool === 'eraser') {
      erasedStrokeIdsRef.current.clear();
      eraseAt(point, event.currentTarget);
      return;
    }

    const stroke: AnnotationStroke = {
      id: createAnnotationStrokeId(),
      tool,
      width: tool === 'highlighter' ? 16 : 2.5,
      points: [point],
      color,
    };
    inProgressRef.current = stroke;
    setInProgress(stroke);
  }, [color, contentHash, eraseAt, strictInkMode, toPoint, tool]);

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

    if (!tool || pointerIdRef.current !== event.pointerId) return;
    event.preventDefault();

    if (tool === 'eraser') {
      eraseAt(toPoint(event), event.currentTarget);
      return;
    }

    const current = inProgressRef.current;
    if (!current || current.points.length >= 2000) return;

    // Pencil gets the browser's coalesced stylus samples when available. This captures
    // the real curve between rendered pointer events without changing Highlighter feel.
    const nativeEvent = event.nativeEvent;
    const samples = tool === 'pencil' && typeof nativeEvent.getCoalescedEvents === 'function'
      ? nativeEvent.getCoalescedEvents()
      : [nativeEvent];
    const sourceSamples = samples.length > 0 ? samples : [nativeEvent];
    const nextPoints = [...current.points];
    let previous = nextPoints[nextPoints.length - 1];
    const minimumDistance = tool === 'pencil' ? 0.0003 : 0.0008;

    for (const sample of sourceSamples) {
      if (nextPoints.length >= 2000) break;
      const point = pointFromClient(event.currentTarget, sample.clientX, sample.clientY);
      if (Math.hypot(point[0] - previous[0], point[1] - previous[1]) < minimumDistance) continue;
      nextPoints.push(point);
      previous = point;
    }

    if (nextPoints.length === current.points.length) return;
    const next: AnnotationStroke = { ...current, points: nextPoints };
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

    // Pencil keeps more of the captured handwriting geometry; Highlighter keeps the
    // previous simplification behavior.
    const tolerance = current.tool === 'pencil' ? 0.0005 : 0.0015;
    const simplified = simplifyAnnotationPoints(points, tolerance).slice(0, 2000);
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

  const renderStrokes = inProgress ? [...visibleStrokes, inProgress] : visibleStrokes;

  return (
    <>
      <svg
        className={`absolute inset-0 z-20 h-full w-full ${tool ? 'pointer-events-auto cursor-crosshair' : 'pointer-events-none'}`}
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        style={{
          touchAction: strictInkMode
            ? 'none'
            : tool === 'highlighter'
              ? 'pan-y pinch-zoom'
              : 'auto',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishStroke}
        onPointerCancel={cancelStroke}
      >
        {renderStrokes.map((stroke) => {
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
    </>
  );
}

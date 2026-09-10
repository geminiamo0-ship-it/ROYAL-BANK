'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  createAnnotationStrokeId,
  distanceToStroke,
  sha256Hex,
  simplifyAnnotationPoints,
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

export function ExamAnnotationLayer({
  surface,
  contentFingerprint,
  tool,
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

  const toPoint = useCallback((event: React.PointerEvent<SVGSVGElement>): AnnotationPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return [0, 0];
    return [
      clampUnit((event.clientX - rect.left) / rect.width),
      clampUnit((event.clientY - rect.top) / rect.height),
    ];
  }, []);

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

    if (!tool || pointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    const point = toPoint(event);

    if (tool === 'eraser') {
      eraseAt(point, event.currentTarget);
      return;
    }

    const current = inProgressRef.current;
    if (!current || current.points.length >= 2000) return;
    const previous = current.points[current.points.length - 1];
    if (Math.hypot(point[0] - previous[0], point[1] - previous[1]) < 0.0008) return;

    const next: AnnotationStroke = { ...current, points: [...current.points, point] };
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

    const simplified = simplifyAnnotationPoints(points).slice(0, 2000);
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
        {renderStrokes.map((stroke) => (
          <polyline
            key={stroke.id}
            points={stroke.points.map(([x, y]) => `${x * 1000},${y * 1000}`).join(' ')}
            fill="none"
            stroke={stroke.tool === 'highlighter' ? 'rgba(255, 226, 94, 0.42)' : '#ffd84d'}
            strokeWidth={stroke.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      {hasStaleRecord ? (
        <div className="pointer-events-none absolute right-2 top-2 z-30 rounded bg-[#453b1f]/95 px-2 py-1 text-[10px] font-medium text-[#ffe9a6] shadow">
          Saved marks hidden: content changed
        </div>
      ) : null}
    </>
  );
}

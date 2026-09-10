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

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
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
    inProgressRef.current = null;
    setInProgress(null);
    erasedStrokeIdsRef.current.clear();
  }, [tool]);

  const visibleStrokes = contentHash && record?.contentHash === contentHash ? record.strokes : [];
  const hasStaleRecord = Boolean(contentHash && record && record.contentHash !== contentHash && record.strokes.length > 0);

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
    if (!tool || !contentHash || event.button !== 0) return;
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
  }, [contentHash, eraseAt, toPoint, tool]);

  const handlePointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!tool || pointerIdRef.current !== event.pointerId) return;
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
    if (pointerIdRef.current !== event.pointerId) return;
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
        style={{ touchAction: tool ? 'none' : 'auto' }}
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

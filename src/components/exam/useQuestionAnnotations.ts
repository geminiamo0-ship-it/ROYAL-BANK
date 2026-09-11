'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearQuestionAnnotationsAction,
  getQuestionAnnotationsAction,
  saveQuestionAnnotationAction,
} from '@/actions/exam-annotations';
import {
  ANNOTATION_SURFACES,
  isValidAnnotationStrokes,
  type AnnotationStroke,
  type AnnotationSurface,
  type StoredQuestionAnnotation,
} from '@/lib/exam-annotations';

type AnnotationRecordMap = Partial<Record<AnnotationSurface, StoredQuestionAnnotation>>;

type PendingSurface = {
  contentHash: string;
  strokes: AnnotationStroke[];
};

type HistoryEntry = {
  surface: AnnotationSurface;
  contentHash: string;
  before: AnnotationStroke[];
  after: AnnotationStroke[];
};

function rowsToMap(rows: StoredQuestionAnnotation[]): AnnotationRecordMap {
  const next: AnnotationRecordMap = {};
  for (const row of rows) next[row.surface] = row;
  return next;
}

export function useQuestionAnnotations(questionId: number | null) {
  const [records, setRecords] = useState<AnnotationRecordMap>({});
  const [isLoading, setIsLoading] = useState(false);
  const [savingCount, setSavingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });

  const activeQuestionRef = useRef<number | null>(questionId);
  const recordsRef = useRef<AnnotationRecordMap>({});
  const versionsRef = useRef<Partial<Record<AnnotationSurface, number>>>({});
  const pendingRef = useRef<Partial<Record<AnnotationSurface, PendingSurface>>>({});
  const timersRef = useRef<Partial<Record<AnnotationSurface, number>>>({});
  const saveChainsRef = useRef<Partial<Record<AnnotationSurface, Promise<void>>>>({});
  const cacheRef = useRef(new Map<number, AnnotationRecordMap>());
  const undoRef = useRef<HistoryEntry[]>([]);
  const redoRef = useRef<HistoryEntry[]>([]);

  activeQuestionRef.current = questionId;

  const syncHistoryState = useCallback(() => {
    setHistoryState({
      canUndo: undoRef.current.length > 0,
      canRedo: redoRef.current.length > 0,
    });
  }, []);

  const commitRecordMap = useCallback((next: AnnotationRecordMap, forQuestionId = questionId) => {
    if (forQuestionId !== activeQuestionRef.current) return;
    recordsRef.current = next;
    setRecords(next);
    if (forQuestionId) cacheRef.current.set(forQuestionId, next);
  }, [questionId]);

  useEffect(() => {
    for (const timer of Object.values(timersRef.current)) {
      if (typeof timer === 'number') window.clearTimeout(timer);
    }
    timersRef.current = {};
    pendingRef.current = {};
    saveChainsRef.current = {};
    undoRef.current = [];
    redoRef.current = [];
    syncHistoryState();
    setError(null);

    if (!questionId) {
      recordsRef.current = {};
      versionsRef.current = {};
      setRecords({});
      setIsLoading(false);
      return undefined;
    }

    const cached = cacheRef.current.get(questionId);
    if (cached) {
      recordsRef.current = cached;
      versionsRef.current = Object.fromEntries(
        ANNOTATION_SURFACES.map((surface) => [surface, cached[surface]?.version || 0]),
      );
      setRecords(cached);
      setIsLoading(false);
    } else {
      recordsRef.current = {};
      versionsRef.current = {};
      setRecords({});
      setIsLoading(true);
    }

    let cancelled = false;
    getQuestionAnnotationsAction(questionId)
      .then((rows) => {
        if (cancelled || activeQuestionRef.current !== questionId) return;
        const next = rowsToMap(rows);
        recordsRef.current = next;
        versionsRef.current = Object.fromEntries(
          ANNOTATION_SURFACES.map((surface) => [surface, next[surface]?.version || 0]),
        );
        cacheRef.current.set(questionId, next);
        setRecords(next);
        setError(null);
      })
      .catch((loadError) => {
        if (cancelled || activeQuestionRef.current !== questionId) return;
        setError(loadError instanceof Error ? loadError.message : 'Unable to load annotations.');
      })
      .finally(() => {
        if (!cancelled && activeQuestionRef.current === questionId) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      for (const timer of Object.values(timersRef.current)) {
        if (typeof timer === 'number') window.clearTimeout(timer);
      }
      timersRef.current = {};
    };
  }, [questionId, syncHistoryState]);

  const persistSurface = useCallback(async (surface: AnnotationSurface) => {
    const targetQuestionId = questionId;
    if (!targetQuestionId) return;

    const previousChain = saveChainsRef.current[surface] || Promise.resolve();
    const nextChain = previousChain
      .catch(() => undefined)
      .then(async () => {
        const pending = pendingRef.current[surface];
        if (!pending || activeQuestionRef.current !== targetQuestionId) return;

        setSavingCount((count) => count + 1);
        try {
          let expectedVersion = versionsRef.current[surface] || 0;
          let saved: StoredQuestionAnnotation;

          try {
            saved = await saveQuestionAnnotationAction({
              questionId: targetQuestionId,
              surface,
              contentHash: pending.contentHash,
              strokes: pending.strokes,
              expectedVersion,
            });
          } catch (saveError) {
            const message = saveError instanceof Error ? saveError.message : String(saveError);
            if (!message.includes('annotation_conflict')) throw saveError;

            const latestRows = await getQuestionAnnotationsAction(targetQuestionId);
            const latest = latestRows.find((row) => row.surface === surface);
            expectedVersion = latest?.version || 0;
            saved = await saveQuestionAnnotationAction({
              questionId: targetQuestionId,
              surface,
              contentHash: pending.contentHash,
              strokes: pending.strokes,
              expectedVersion,
            });
          }

          versionsRef.current[surface] = saved.version;
          if (activeQuestionRef.current === targetQuestionId) {
            const current = recordsRef.current[surface];
            if (current) {
              const next: AnnotationRecordMap = {
                ...recordsRef.current,
                [surface]: {
                  ...current,
                  version: saved.version,
                  updatedAt: saved.updatedAt,
                },
              };
              commitRecordMap(next, targetQuestionId);
            }
            if (pendingRef.current[surface] === pending) delete pendingRef.current[surface];
            setError(null);
          }
        } catch (saveError) {
          if (activeQuestionRef.current === targetQuestionId) {
            setError(saveError instanceof Error ? saveError.message : 'Unable to save annotations.');
          }
          throw saveError;
        } finally {
          setSavingCount((count) => Math.max(0, count - 1));
        }
      });

    saveChainsRef.current[surface] = nextChain;
    await nextChain;
  }, [commitRecordMap, questionId]);

  const schedulePersist = useCallback((surface: AnnotationSurface) => {
    const existing = timersRef.current[surface];
    if (typeof existing === 'number') window.clearTimeout(existing);
    timersRef.current[surface] = window.setTimeout(() => {
      delete timersRef.current[surface];
      void persistSurface(surface).catch(() => undefined);
    }, 900);
  }, [persistSurface]);

  const applySurface = useCallback((
    surface: AnnotationSurface,
    contentHash: string,
    strokes: AnnotationStroke[],
  ) => {
    if (!questionId || !isValidAnnotationStrokes(strokes)) {
      setError('Annotation limit reached or the drawing payload is invalid.');
      return false;
    }

    const currentVersion = versionsRef.current[surface] || 0;
    const nextRecord: StoredQuestionAnnotation = {
      surface,
      contentHash,
      strokes,
      version: currentVersion,
      updatedAt: new Date().toISOString(),
    };
    const next: AnnotationRecordMap = {
      ...recordsRef.current,
      [surface]: nextRecord,
    };

    commitRecordMap(next, questionId);
    pendingRef.current[surface] = { contentHash, strokes };
    setError(null);
    schedulePersist(surface);
    return true;
  }, [commitRecordMap, questionId, schedulePersist]);

  const appendStroke = useCallback((
    surface: AnnotationSurface,
    contentHash: string,
    stroke: AnnotationStroke,
  ) => {
    const current = recordsRef.current[surface];
    const before = current?.contentHash === contentHash ? current.strokes : [];
    const after = [...before, stroke];
    if (!applySurface(surface, contentHash, after)) return;

    undoRef.current.push({ surface, contentHash, before, after });
    if (undoRef.current.length > 100) undoRef.current.shift();
    redoRef.current = [];
    syncHistoryState();
  }, [applySurface, syncHistoryState]);

  const eraseStroke = useCallback((
    surface: AnnotationSurface,
    contentHash: string,
    strokeId: string,
  ) => {
    const current = recordsRef.current[surface];
    if (!current || current.contentHash !== contentHash) return;
    const before = current.strokes;
    const after = before.filter((stroke) => stroke.id !== strokeId);
    if (after.length === before.length || !applySurface(surface, contentHash, after)) return;

    undoRef.current.push({ surface, contentHash, before, after });
    if (undoRef.current.length > 100) undoRef.current.shift();
    redoRef.current = [];
    syncHistoryState();
  }, [applySurface, syncHistoryState]);

  const undo = useCallback(() => {
    const entry = undoRef.current.pop();
    if (!entry) return;
    if (applySurface(entry.surface, entry.contentHash, entry.before)) {
      redoRef.current.push(entry);
    } else {
      undoRef.current.push(entry);
    }
    syncHistoryState();
  }, [applySurface, syncHistoryState]);

  const redo = useCallback(() => {
    const entry = redoRef.current.pop();
    if (!entry) return;
    if (applySurface(entry.surface, entry.contentHash, entry.after)) {
      undoRef.current.push(entry);
    } else {
      redoRef.current.push(entry);
    }
    syncHistoryState();
  }, [applySurface, syncHistoryState]);

  const flush = useCallback(async () => {
    for (const timer of Object.values(timersRef.current)) {
      if (typeof timer === 'number') window.clearTimeout(timer);
    }
    timersRef.current = {};

    for (let pass = 0; pass < 4; pass += 1) {
      const dirtySurfaces = ANNOTATION_SURFACES.filter((surface) => Boolean(pendingRef.current[surface]));
      if (dirtySurfaces.length === 0) break;
      await Promise.all(dirtySurfaces.map((surface) => persistSurface(surface)));
    }

    const remaining = ANNOTATION_SURFACES.some((surface) => Boolean(pendingRef.current[surface]));
    if (remaining) throw new Error('Unable to finish saving annotations.');
  }, [persistSurface]);

  const clearAll = useCallback(async () => {
    const targetQuestionId = questionId;
    if (!targetQuestionId) return;

    await flush();
    await clearQuestionAnnotationsAction(targetQuestionId);
    if (activeQuestionRef.current !== targetQuestionId) return;

    pendingRef.current = {};
    versionsRef.current = {};
    undoRef.current = [];
    redoRef.current = [];
    cacheRef.current.set(targetQuestionId, {});
    commitRecordMap({}, targetQuestionId);
    setError(null);
    syncHistoryState();
  }, [commitRecordMap, flush, questionId, syncHistoryState]);

  return {
    records,
    isLoading,
    isSaving: savingCount > 0,
    error,
    canUndo: historyState.canUndo,
    canRedo: historyState.canRedo,
    appendStroke,
    eraseStroke,
    undo,
    redo,
    clearAll,
    flush,
  };
}

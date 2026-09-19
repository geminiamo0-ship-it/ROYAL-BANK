'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getQuestionAnnotationsAction } from '@/actions/exam-annotations';
import {
  clearExamAnnotationsDirect,
  getExamAnnotationsDirect,
  saveExamAnnotationsBatchDirect,
} from '@/lib/exam-client-api';
import {
  ANNOTATION_SURFACES,
  isAnnotationSurface,
  isValidAnnotationStroke,
  isValidAnnotationStrokes,
  type AnnotationStroke,
  type AnnotationSurface,
  type StoredQuestionAnnotation,
} from '@/lib/exam-annotations';

type AnnotationRecordMap = Partial<Record<AnnotationSurface, StoredQuestionAnnotation>>;
type ErrorMap = Partial<Record<AnnotationSurface, string>>;

type PendingSurface = {
  contentHash: string;
  strokes: AnnotationStroke[];
};

type QuestionAnnotationState = {
  records: AnnotationRecordMap;
  pending: Partial<Record<AnnotationSurface, PendingSurface>>;
  timer: number | null;
  saveChain: Promise<void>;
  errors: ErrorMap;
  loaded: boolean;
};

type HistoryEntry = {
  surface: AnnotationSurface;
  contentHash: string;
  before: AnnotationStroke[];
  after: AnnotationStroke[];
};

type PersistedRecovery = Record<string, Partial<Record<AnnotationSurface, PendingSurface>>>;

const RECOVERY_PREFIX = 'royal.exam.pending-annotations:';
const ANNOTATION_BATCH_DEBOUNCE_MS = 1_750;

function createQuestionState(): QuestionAnnotationState {
  return {
    records: {},
    pending: {},
    timer: null,
    saveChain: Promise.resolve(),
    errors: {},
    loaded: false,
  };
}

function rowsToMap(rows: StoredQuestionAnnotation[]): AnnotationRecordMap {
  const next: AnnotationRecordMap = {};
  for (const row of rows) next[row.surface] = row;
  return next;
}

function recoveryKey(scope: string): string {
  return `${RECOVERY_PREFIX}${scope}`;
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function readRecovery(scope: string): PersistedRecovery {
  if (typeof window === 'undefined' || !scope) return {};
  try {
    const raw = window.sessionStorage.getItem(recoveryKey(scope));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const safe: PersistedRecovery = {};
    for (const [rawQuestionId, rawSurfaces] of Object.entries(parsed as Record<string, unknown>)) {
      const questionId = Number(rawQuestionId);
      if (!Number.isSafeInteger(questionId) || questionId <= 0) continue;
      if (!rawSurfaces || typeof rawSurfaces !== 'object' || Array.isArray(rawSurfaces)) continue;

      const safeSurfaces: Partial<Record<AnnotationSurface, PendingSurface>> = {};
      for (const [rawSurface, rawPending] of Object.entries(rawSurfaces as Record<string, unknown>)) {
        if (!isAnnotationSurface(rawSurface)) continue;
        if (!rawPending || typeof rawPending !== 'object' || Array.isArray(rawPending)) continue;
        const pending = rawPending as Record<string, unknown>;
        if (!validHash(pending.contentHash) || !isValidAnnotationStrokes(pending.strokes)) continue;
        safeSurfaces[rawSurface] = {
          contentHash: pending.contentHash,
          strokes: pending.strokes,
        };
      }
      if (Object.keys(safeSurfaces).length > 0) safe[String(questionId)] = safeSurfaces;
    }
    return safe;
  } catch {
    return {};
  }
}

export function useQuestionAnnotations(questionId: number | null, sessionId = '') {
  const [records, setRecords] = useState<AnnotationRecordMap>({});
  const [isLoading, setIsLoading] = useState(false);
  const [savingCount, setSavingCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });

  const activeQuestionRef = useRef<number | null>(questionId);
  const statesRef = useRef(new Map<number, QuestionAnnotationState>());
  const recoveryLoadedScopeRef = useRef<string | null>(null);
  const recoveryScheduledScopeRef = useRef<string | null>(null);
  const undoRef = useRef<HistoryEntry[]>([]);
  const redoRef = useRef<HistoryEntry[]>([]);

  activeQuestionRef.current = questionId;

  const getState = useCallback((targetQuestionId: number) => {
    let state = statesRef.current.get(targetQuestionId);
    if (!state) {
      state = createQuestionState();
      statesRef.current.set(targetQuestionId, state);
    }
    return state;
  }, []);

  const syncHistoryState = useCallback(() => {
    setHistoryState({
      canUndo: undoRef.current.length > 0,
      canRedo: redoRef.current.length > 0,
    });
  }, []);

  const syncActiveError = useCallback((targetQuestionId: number) => {
    if (targetQuestionId !== activeQuestionRef.current) return;
    const state = getState(targetQuestionId);
    const firstError = ANNOTATION_SURFACES
      .map((surface) => state.errors[surface])
      .find((message): message is string => Boolean(message));
    setError(firstError || null);
  }, [getState]);

  const persistRecovery = useCallback(() => {
    if (typeof window === 'undefined' || !sessionId) return;

    const payload: PersistedRecovery = {};
    for (const [targetQuestionId, state] of statesRef.current) {
      const surfaces: Partial<Record<AnnotationSurface, PendingSurface>> = {};
      for (const surface of ANNOTATION_SURFACES) {
        const pending = state.pending[surface];
        if (pending) surfaces[surface] = pending;
      }
      if (Object.keys(surfaces).length > 0) payload[String(targetQuestionId)] = surfaces;
    }

    try {
      const key = recoveryKey(sessionId);
      if (Object.keys(payload).length === 0) window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key, JSON.stringify(payload));
    } catch {
      // Recovery is best effort. Pending edits remain in memory while the page is open.
    }
  }, [sessionId]);

  const commitRecordMap = useCallback((next: AnnotationRecordMap, targetQuestionId: number) => {
    const state = getState(targetQuestionId);
    state.records = next;
    if (targetQuestionId === activeQuestionRef.current) setRecords(next);
  }, [getState]);

  useEffect(() => {
    if (!sessionId || recoveryLoadedScopeRef.current === sessionId) return;
    recoveryLoadedScopeRef.current = sessionId;
    const recovered = readRecovery(sessionId);
    let recoveredPendingCount = 0;

    for (const [rawQuestionId, surfaces] of Object.entries(recovered)) {
      const targetQuestionId = Number(rawQuestionId);
      const state = getState(targetQuestionId);
      for (const surface of ANNOTATION_SURFACES) {
        const pending = surfaces[surface];
        if (!pending) continue;
        state.pending[surface] = pending;
        state.records[surface] = {
          surface,
          contentHash: pending.contentHash,
          strokes: pending.strokes,
          version: 0,
          updatedAt: new Date().toISOString(),
        };
        recoveredPendingCount += 1;
      }
    }

    if (recoveredPendingCount > 0) {
      const timeoutId = window.setTimeout(() => setPendingCount(recoveredPendingCount), 0);
      return () => window.clearTimeout(timeoutId);
    }
  }, [getState, sessionId]);

  const loadQuestion = useCallback(async (targetQuestionId: number) => {
    if (!sessionId) throw new Error('Exam session is not ready.');

    let edge = await getExamAnnotationsDirect(sessionId, targetQuestionId);
    if (!edge.hydrated) {
      // One-time bridge for annotations created before the DO path existed.
      const legacy = await getQuestionAnnotationsAction(targetQuestionId);
      edge = await saveExamAnnotationsBatchDirect({
        sessionId,
        questionId: targetQuestionId,
        seed: true,
        updates: legacy.map((record) => ({
          surface: record.surface,
          contentHash: record.contentHash,
          strokes: record.strokes,
        })),
      });
    }
    return edge.records;
  }, [sessionId]);

  useEffect(() => {
    undoRef.current = [];
    redoRef.current = [];
    syncHistoryState();

    if (!questionId || !sessionId) {
      setRecords({});
      setIsLoading(false);
      setError(null);
      return undefined;
    }

    const state = getState(questionId);
    setRecords({ ...state.records });
    syncActiveError(questionId);

    if (state.loaded) {
      setIsLoading(false);
      return undefined;
    }

    setIsLoading(true);
    let cancelled = false;
    loadQuestion(questionId)
      .then((rows) => {
        const serverRecords = rowsToMap(rows);
        const currentState = getState(questionId);

        for (const surface of ANNOTATION_SURFACES) {
          if (currentState.pending[surface]) continue;
          const serverRecord = serverRecords[surface];
          if (serverRecord) currentState.records[surface] = serverRecord;
          else delete currentState.records[surface];
        }

        currentState.loaded = true;
        if (!cancelled && activeQuestionRef.current === questionId) {
          setRecords({ ...currentState.records });
          syncActiveError(questionId);
        }
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
    };
  }, [getState, loadQuestion, questionId, sessionId, syncActiveError, syncHistoryState]);

  const persistQuestion = useCallback(async (targetQuestionId: number) => {
    if (!sessionId) return;
    const state = getState(targetQuestionId);

    const run = async () => {
      const captured = Object.fromEntries(
        ANNOTATION_SURFACES
          .map((surface) => [surface, state.pending[surface]] as const)
          .filter((entry): entry is [AnnotationSurface, PendingSurface] => Boolean(entry[1])),
      ) as Partial<Record<AnnotationSurface, PendingSurface>>;
      const dirtySurfaces = ANNOTATION_SURFACES.filter((surface) => Boolean(captured[surface]));
      if (dirtySurfaces.length === 0) return;

      setSavingCount((count) => count + 1);
      try {
        const saved = await saveExamAnnotationsBatchDirect({
          sessionId,
          questionId: targetQuestionId,
          updates: dirtySurfaces.map((surface) => ({
            surface,
            contentHash: captured[surface]!.contentHash,
            strokes: captured[surface]!.strokes,
          })),
        });
        const savedMap = rowsToMap(saved.records);

        for (const surface of dirtySurfaces) {
          if (state.pending[surface] !== captured[surface]) continue;
          delete state.pending[surface];
          setPendingCount((count) => Math.max(0, count - 1));
          const savedRecord = savedMap[surface];
          if (savedRecord) state.records[surface] = savedRecord;
          delete state.errors[surface];
        }

        persistRecovery();
        if (activeQuestionRef.current === targetQuestionId) {
          setRecords({ ...state.records });
          syncActiveError(targetQuestionId);
        }
      } catch (saveError) {
        const message = saveError instanceof Error ? saveError.message : 'Unable to save annotations.';
        for (const surface of dirtySurfaces) state.errors[surface] = message;
        persistRecovery();
        syncActiveError(targetQuestionId);
        throw saveError;
      } finally {
        setSavingCount((count) => Math.max(0, count - 1));
      }
    };

    state.saveChain = state.saveChain.catch(() => undefined).then(run);
    await state.saveChain;

  }, [getState, persistRecovery, sessionId, syncActiveError]);

  const schedulePersist = useCallback((targetQuestionId: number) => {
    const state = getState(targetQuestionId);
    if (state.timer != null) window.clearTimeout(state.timer);
    state.timer = window.setTimeout(() => {
      state.timer = null;
      void persistQuestion(targetQuestionId).catch(() => undefined);
    }, ANNOTATION_BATCH_DEBOUNCE_MS);
  }, [getState, persistQuestion]);

  useEffect(() => {
    if (!sessionId || recoveryScheduledScopeRef.current === sessionId) return;
    recoveryScheduledScopeRef.current = sessionId;
    const timeoutId = window.setTimeout(() => {
      for (const [targetQuestionId, state] of statesRef.current) {
        if (
          ANNOTATION_SURFACES.some((surface) => Boolean(state.pending[surface]))
          && state.timer == null
        ) {
          schedulePersist(targetQuestionId);
        }
      }
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [schedulePersist, sessionId]);

  const applySurface = useCallback((
    surface: AnnotationSurface,
    contentHash: string,
    strokes: AnnotationStroke[],
  ) => {
    const targetQuestionId = questionId;
    if (!targetQuestionId || !isValidAnnotationStrokes(strokes)) {
      setError('Annotation limit reached or the drawing payload is invalid.');
      return false;
    }

    const state = getState(targetQuestionId);
    const existingPending = state.pending[surface];
    const nextRecord: StoredQuestionAnnotation = {
      surface,
      contentHash,
      strokes,
      version: state.records[surface]?.version || 0,
      updatedAt: new Date().toISOString(),
    };

    state.records = { ...state.records, [surface]: nextRecord };
    state.pending[surface] = { contentHash, strokes };
    if (!existingPending) setPendingCount((count) => count + 1);
    delete state.errors[surface];

    // Local state is authoritative for interaction speed. Network persistence is deferred.
    commitRecordMap(state.records, targetQuestionId);
    syncActiveError(targetQuestionId);
    persistRecovery();
    schedulePersist(targetQuestionId);
    return true;
  }, [
    commitRecordMap,
    getState,
    persistRecovery,
    questionId,
    schedulePersist,
    syncActiveError,
  ]);

  const appendStroke = useCallback((
    surface: AnnotationSurface,
    contentHash: string,
    stroke: AnnotationStroke,
  ) => {
    if (!questionId) return;
    const state = getState(questionId);
    const current = state.records[surface];
    const before = current?.contentHash === contentHash ? current.strokes : [];
    const after = [...before, stroke];
    if (!applySurface(surface, contentHash, after)) return;

    undoRef.current.push({ surface, contentHash, before, after });
    if (undoRef.current.length > 100) undoRef.current.shift();
    redoRef.current = [];
    syncHistoryState();
  }, [applySurface, getState, questionId, syncHistoryState]);

  const eraseStroke = useCallback((
    surface: AnnotationSurface,
    contentHash: string,
    strokeId: string,
  ) => {
    if (!questionId) return;
    const state = getState(questionId);
    const current = state.records[surface];
    if (!current || current.contentHash !== contentHash) return;
    const before = current.strokes;
    const after = before.filter((stroke) => stroke.id !== strokeId);
    if (after.length === before.length || !applySurface(surface, contentHash, after)) return;

    undoRef.current.push({ surface, contentHash, before, after });
    if (undoRef.current.length > 100) undoRef.current.shift();
    redoRef.current = [];
    syncHistoryState();
  }, [applySurface, getState, questionId, syncHistoryState]);

  const updateStroke = useCallback((
    surface: AnnotationSurface,
    contentHash: string,
    stroke: AnnotationStroke,
  ) => {
    if (!questionId || !isValidAnnotationStroke(stroke)) return;
    const state = getState(questionId);
    const current = state.records[surface];
    if (!current || current.contentHash !== contentHash) return;

    const index = current.strokes.findIndex((candidate) => candidate.id === stroke.id);
    if (index < 0) return;

    const before = current.strokes;
    const after = before.map((candidate, candidateIndex) => (
      candidateIndex === index ? stroke : candidate
    ));
    if (!applySurface(surface, contentHash, after)) return;

    undoRef.current.push({ surface, contentHash, before, after });
    if (undoRef.current.length > 100) undoRef.current.shift();
    redoRef.current = [];
    syncHistoryState();
  }, [applySurface, getState, questionId, syncHistoryState]);

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

  const flushQuestion = useCallback(async (targetQuestionId: number) => {
    const state = getState(targetQuestionId);
    if (state.timer != null) {
      window.clearTimeout(state.timer);
      state.timer = null;
    }

    for (let pass = 0; pass < 4; pass += 1) {
      if (!ANNOTATION_SURFACES.some((surface) => Boolean(state.pending[surface]))) break;
      await persistQuestion(targetQuestionId);
    }

    if (ANNOTATION_SURFACES.some((surface) => Boolean(state.pending[surface]))) {
      throw new Error('Unable to finish saving annotations.');
    }
  }, [getState, persistQuestion]);

  const flush = useCallback(async () => {
    const questionIds = [...statesRef.current.keys()];
    await Promise.all(questionIds.map((targetQuestionId) => flushQuestion(targetQuestionId)));
    persistRecovery();
  }, [flushQuestion, persistRecovery]);

  const clearAll = useCallback(async () => {
    const targetQuestionId = questionId;
    if (!targetQuestionId || !sessionId) return;

    const state = getState(targetQuestionId);
    if (state.timer != null) {
      window.clearTimeout(state.timer);
      state.timer = null;
    }
    await state.saveChain.catch(() => undefined);
    await clearExamAnnotationsDirect(sessionId, targetQuestionId);

    const pendingToClear = ANNOTATION_SURFACES.filter((surface) => Boolean(state.pending[surface])).length;
    state.records = {};
    state.pending = {};
    state.errors = {};
    state.loaded = true;
    if (pendingToClear > 0) {
      setPendingCount((count) => Math.max(0, count - pendingToClear));
    }

    undoRef.current = [];
    redoRef.current = [];
    persistRecovery();
    if (activeQuestionRef.current === targetQuestionId) {
      setRecords({});
      setError(null);
      syncHistoryState();
    }
  }, [getState, persistRecovery, questionId, sessionId, syncActiveError, syncHistoryState]);

  return {
    records,
    isLoading,
    isSaving: savingCount > 0 || pendingCount > 0,
    error,
    canUndo: historyState.canUndo,
    canRedo: historyState.canRedo,
    appendStroke,
    eraseStroke,
    updateStroke,
    undo,
    redo,
    clearAll,
    flush,
  };
}

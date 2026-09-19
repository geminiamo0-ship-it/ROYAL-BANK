'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearQuestionAnnotationsAction,
  getQuestionAnnotationsAction,
  saveQuestionAnnotationAction,
} from '@/actions/exam-annotations';
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
type VersionMap = Partial<Record<AnnotationSurface, number>>;
type ErrorMap = Partial<Record<AnnotationSurface, string>>;

type PendingSurface = {
  contentHash: string;
  strokes: AnnotationStroke[];
  baseContentHash: string | null;
  baseStrokes: AnnotationStroke[];
};

type QuestionAnnotationState = {
  records: AnnotationRecordMap;
  versions: VersionMap;
  pending: Partial<Record<AnnotationSurface, PendingSurface>>;
  timers: Partial<Record<AnnotationSurface, number>>;
  saveChains: Partial<Record<AnnotationSurface, Promise<void>>>;
  errors: ErrorMap;
  loaded: boolean;
};

type HistoryEntry = {
  surface: AnnotationSurface;
  contentHash: string;
  before: AnnotationStroke[];
  after: AnnotationStroke[];
};

type PersistedPendingSurface = PendingSurface & {
  expectedVersion: number;
};

type PersistedRecovery = Record<string, Partial<Record<AnnotationSurface, PersistedPendingSurface>>>;

const RECOVERY_PREFIX = 'royal.exam.pending-annotations:';

function createQuestionState(): QuestionAnnotationState {
  return {
    records: {},
    versions: {},
    pending: {},
    timers: {},
    saveChains: {},
    errors: {},
    loaded: false,
  };
}

function rowsToMap(rows: StoredQuestionAnnotation[]): AnnotationRecordMap {
  const next: AnnotationRecordMap = {};
  for (const row of rows) next[row.surface] = row;
  return next;
}

function strokeEquals(left: AnnotationStroke | undefined, right: AnnotationStroke): boolean {
  return Boolean(left) && JSON.stringify(left) === JSON.stringify(right);
}

function mergeAnnotationDelta(
  pending: PendingSurface,
  latest: StoredQuestionAnnotation | undefined,
): AnnotationStroke[] | null {
  if (!latest) return pending.strokes;
  if (latest.contentHash !== pending.contentHash) return null;

  const baseById = new Map(pending.baseStrokes.map((stroke) => [stroke.id, stroke]));
  const localById = new Map(pending.strokes.map((stroke) => [stroke.id, stroke]));
  const latestById = new Map(latest.strokes.map((stroke) => [stroke.id, stroke]));

  for (const id of baseById.keys()) {
    if (!localById.has(id)) latestById.delete(id);
  }

  for (const [id, localStroke] of localById) {
    if (!strokeEquals(baseById.get(id), localStroke)) latestById.set(id, localStroke);
  }

  const merged: AnnotationStroke[] = [];
  const emitted = new Set<string>();

  for (const stroke of latest.strokes) {
    const value = latestById.get(stroke.id);
    if (!value || emitted.has(stroke.id)) continue;
    merged.push(value);
    emitted.add(stroke.id);
  }

  for (const stroke of pending.strokes) {
    const value = latestById.get(stroke.id);
    if (!value || emitted.has(stroke.id)) continue;
    merged.push(value);
    emitted.add(stroke.id);
  }

  return isValidAnnotationStrokes(merged) ? merged : null;
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

      const safeSurfaces: Partial<Record<AnnotationSurface, PersistedPendingSurface>> = {};
      for (const [rawSurface, rawPending] of Object.entries(rawSurfaces as Record<string, unknown>)) {
        if (!isAnnotationSurface(rawSurface)) continue;
        if (!rawPending || typeof rawPending !== 'object' || Array.isArray(rawPending)) continue;
        const pending = rawPending as Record<string, unknown>;
        const expectedVersion = Number(pending.expectedVersion);
        const baseContentHash = pending.baseContentHash;
        if (
          !validHash(pending.contentHash) ||
          !isValidAnnotationStrokes(pending.strokes) ||
          !(baseContentHash === null || validHash(baseContentHash)) ||
          !isValidAnnotationStrokes(pending.baseStrokes) ||
          !Number.isInteger(expectedVersion) || expectedVersion < 0
        ) {
          continue;
        }

        safeSurfaces[rawSurface] = {
          contentHash: pending.contentHash,
          strokes: pending.strokes,
          baseContentHash,
          baseStrokes: pending.baseStrokes,
          expectedVersion,
        };
      }
      if (Object.keys(safeSurfaces).length > 0) safe[String(questionId)] = safeSurfaces;
    }
    return safe;
  } catch {
    return {};
  }
}

export function useQuestionAnnotations(questionId: number | null, recoveryScope = '') {
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
    if (typeof window === 'undefined' || !recoveryScope) return;

    const payload: PersistedRecovery = {};
    for (const [targetQuestionId, state] of statesRef.current) {
      const surfaces: Partial<Record<AnnotationSurface, PersistedPendingSurface>> = {};
      for (const surface of ANNOTATION_SURFACES) {
        const pending = state.pending[surface];
        if (!pending) continue;
        surfaces[surface] = {
          ...pending,
          expectedVersion: state.versions[surface] || 0,
        };
      }
      if (Object.keys(surfaces).length > 0) payload[String(targetQuestionId)] = surfaces;
    }

    try {
      const key = recoveryKey(recoveryScope);
      if (Object.keys(payload).length === 0) window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key, JSON.stringify(payload));
    } catch {
      // Recovery is best effort. The live save queue remains authoritative while
      // the page is open and server version checks prevent unsafe overwrites.
    }
  }, [recoveryScope]);

  const commitRecordMap = useCallback((next: AnnotationRecordMap, targetQuestionId: number) => {
    const state = getState(targetQuestionId);
    state.records = next;
    if (targetQuestionId === activeQuestionRef.current) setRecords(next);
  }, [getState]);

  useEffect(() => {
    if (!recoveryScope || recoveryLoadedScopeRef.current === recoveryScope) return;
    recoveryLoadedScopeRef.current = recoveryScope;
    const recovered = readRecovery(recoveryScope);
    let recoveredPendingCount = 0;

    for (const [rawQuestionId, surfaces] of Object.entries(recovered)) {
      const targetQuestionId = Number(rawQuestionId);
      const state = getState(targetQuestionId);
      for (const surface of ANNOTATION_SURFACES) {
        const pending = surfaces[surface];
        if (!pending) continue;
        state.pending[surface] = {
          contentHash: pending.contentHash,
          strokes: pending.strokes,
          baseContentHash: pending.baseContentHash,
          baseStrokes: pending.baseStrokes,
        };
        state.versions[surface] = pending.expectedVersion;
        state.records[surface] = {
          surface,
          contentHash: pending.contentHash,
          strokes: pending.strokes,
          version: pending.expectedVersion,
          updatedAt: new Date().toISOString(),
        };
        recoveredPendingCount += 1;
      }
    }

    if (recoveredPendingCount > 0) {
      const timeoutId = window.setTimeout(() => setPendingCount(recoveredPendingCount), 0);
      return () => window.clearTimeout(timeoutId);
    }
  }, [getState, recoveryScope]);

  useEffect(() => {
    undoRef.current = [];
    redoRef.current = [];
    syncHistoryState();

    if (!questionId) {
      setRecords({});
      setIsLoading(false);
      setError(null);
      return undefined;
    }

    const state = getState(questionId);
    setRecords(state.records);
    syncActiveError(questionId);

    if (state.loaded) {
      setIsLoading(false);
      return undefined;
    }

    setIsLoading(true);
    let cancelled = false;
    getQuestionAnnotationsAction(questionId)
      .then((rows) => {
        const serverRecords = rowsToMap(rows);
        const currentState = getState(questionId);

        for (const surface of ANNOTATION_SURFACES) {
          const serverRecord = serverRecords[surface];
          if (currentState.pending[surface]) continue;

          if (serverRecord) {
            currentState.records[surface] = serverRecord;
            currentState.versions[surface] = serverRecord.version;
          } else {
            delete currentState.records[surface];
            currentState.versions[surface] = 0;
          }
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
  }, [getState, questionId, syncActiveError, syncHistoryState]);

  const persistSurface = useCallback(async (
    targetQuestionId: number,
    surface: AnnotationSurface,
  ) => {
    const state = getState(targetQuestionId);
    const previousChain = state.saveChains[surface] || Promise.resolve();
    const nextChain = previousChain
      .catch(() => undefined)
      .then(async () => {
        const pending = state.pending[surface];
        if (!pending) return;

        setSavingCount((count) => count + 1);
        try {
          let saved: StoredQuestionAnnotation;
          const expectedVersion = state.versions[surface] || 0;

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
            const merged = mergeAnnotationDelta(pending, latest);
            if (!merged) {
              throw new Error('Annotation conflict could not be merged safely. Reload this question before editing these marks again.');
            }

            saved = await saveQuestionAnnotationAction({
              questionId: targetQuestionId,
              surface,
              contentHash: pending.contentHash,
              strokes: merged,
              expectedVersion: latest?.version || 0,
            });
          }

          state.versions[surface] = saved.version;
          delete state.errors[surface];

          if (state.pending[surface] === pending) {
            delete state.pending[surface];
            setPendingCount((count) => Math.max(0, count - 1));
            state.records = { ...state.records, [surface]: saved };
          } else {
            const newerPending = state.pending[surface];
            if (!newerPending || newerPending.contentHash !== saved.contentHash) {
              throw new Error('Annotation content changed while resolving a save conflict. Reload this question before editing these marks again.');
            }

            // Reapply only the edits that happened after this request started on
            // top of the exact server snapshot that was just saved. This preserves
            // remote strokes merged during the request and prevents the next local
            // save from silently replacing them with an older local snapshot.
            const rebasedStrokes = mergeAnnotationDelta(
              {
                contentHash: newerPending.contentHash,
                strokes: newerPending.strokes,
                baseContentHash: pending.contentHash,
                baseStrokes: pending.strokes,
              },
              saved,
            );
            if (!rebasedStrokes) {
              throw new Error('Annotation edits could not be rebased safely after a concurrent update. Reload this question before editing these marks again.');
            }

            state.pending[surface] = {
              contentHash: newerPending.contentHash,
              strokes: rebasedStrokes,
              baseContentHash: saved.contentHash,
              baseStrokes: saved.strokes,
            };
            state.records = {
              ...state.records,
              [surface]: { ...saved, strokes: rebasedStrokes },
            };
          }

          persistRecovery();
          if (activeQuestionRef.current === targetQuestionId) {
            setRecords({ ...state.records });
            syncActiveError(targetQuestionId);
          }
        } catch (saveError) {
          state.errors[surface] = saveError instanceof Error
            ? saveError.message
            : 'Unable to save annotations.';
          persistRecovery();
          syncActiveError(targetQuestionId);
          throw saveError;
        } finally {
          setSavingCount((count) => Math.max(0, count - 1));
        }
      });

    state.saveChains[surface] = nextChain;
    await nextChain;
  }, [getState, persistRecovery, syncActiveError]);

  const schedulePersist = useCallback((targetQuestionId: number, surface: AnnotationSurface) => {
    const state = getState(targetQuestionId);
    const existing = state.timers[surface];
    if (typeof existing === 'number') window.clearTimeout(existing);
    state.timers[surface] = window.setTimeout(() => {
      delete state.timers[surface];
      void persistSurface(targetQuestionId, surface).catch(() => undefined);
    }, 900);
  }, [getState, persistSurface]);

  useEffect(() => {
    if (!recoveryScope || recoveryScheduledScopeRef.current === recoveryScope) return;
    recoveryScheduledScopeRef.current = recoveryScope;
    const timeoutId = window.setTimeout(() => {
      for (const [targetQuestionId, state] of statesRef.current) {
        for (const surface of ANNOTATION_SURFACES) {
          if (!state.pending[surface] || typeof state.timers[surface] === 'number') continue;
          schedulePersist(targetQuestionId, surface);
        }
      }
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [recoveryScope, schedulePersist]);

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
    const current = state.records[surface];
    const existingPending = state.pending[surface];
    const currentVersion = state.versions[surface] || 0;
    const nextRecord: StoredQuestionAnnotation = {
      surface,
      contentHash,
      strokes,
      version: currentVersion,
      updatedAt: new Date().toISOString(),
    };

    state.records = { ...state.records, [surface]: nextRecord };
    state.pending[surface] = {
      contentHash,
      strokes,
      baseContentHash: existingPending?.baseContentHash ?? current?.contentHash ?? null,
      baseStrokes: existingPending?.baseStrokes ?? (
        current?.contentHash === contentHash ? current.strokes : []
      ),
    };
    if (!existingPending) setPendingCount((count) => count + 1);
    delete state.errors[surface];
    commitRecordMap(state.records, targetQuestionId);
    syncActiveError(targetQuestionId);
    persistRecovery();
    schedulePersist(targetQuestionId, surface);
    return true;
  }, [commitRecordMap, getState, persistRecovery, questionId, schedulePersist, syncActiveError]);

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
    for (const timer of Object.values(state.timers)) {
      if (typeof timer === 'number') window.clearTimeout(timer);
    }
    state.timers = {};

    for (let pass = 0; pass < 4; pass += 1) {
      const dirtySurfaces = ANNOTATION_SURFACES.filter((surface) => Boolean(state.pending[surface]));
      if (dirtySurfaces.length === 0) break;
      await Promise.all(dirtySurfaces.map((surface) => persistSurface(targetQuestionId, surface)));
    }

    const remaining = ANNOTATION_SURFACES.some((surface) => Boolean(state.pending[surface]));
    if (remaining) throw new Error('Unable to finish saving annotations.');
  }, [getState, persistSurface]);

  const flush = useCallback(async () => {
    const questionIds = [...statesRef.current.keys()];
    await Promise.all(questionIds.map((targetQuestionId) => flushQuestion(targetQuestionId)));
    persistRecovery();
  }, [flushQuestion, persistRecovery]);

  const clearAll = useCallback(async () => {
    const targetQuestionId = questionId;
    if (!targetQuestionId) return;

    await flushQuestion(targetQuestionId);
    await clearQuestionAnnotationsAction(targetQuestionId);

    const state = getState(targetQuestionId);
    const pendingToClear = ANNOTATION_SURFACES.filter((surface) => Boolean(state.pending[surface])).length;
    for (const timer of Object.values(state.timers)) {
      if (typeof timer === 'number') window.clearTimeout(timer);
    }
    state.records = {};
    state.versions = {};
    state.pending = {};
    state.timers = {};
    state.saveChains = {};
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
  }, [flushQuestion, getState, persistRecovery, questionId, syncHistoryState]);

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

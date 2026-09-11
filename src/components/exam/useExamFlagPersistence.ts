'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { setQuestionFlagDirect } from '@/lib/exam-client-api';
import { ExamGatewayError } from '@/lib/exam-gateway-client';

type PendingFlagWrite = {
  operationId: string;
  questionId: number;
  flagged: boolean;
};

type PersistedFlagWrites = Record<string, PendingFlagWrite>;

const MAX_SAVE_ATTEMPTS = 2;

function storageKey(sessionId: string): string {
  return `royal.exam.pending-flags:${sessionId}`;
}

function loadPendingWrites(sessionId: string): PersistedFlagWrites {
  if (typeof window === 'undefined' || !sessionId) return {};
  try {
    const raw = window.sessionStorage.getItem(storageKey(sessionId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const safe: PersistedFlagWrites = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const record = value as Record<string, unknown>;
      const questionId = Number(record.questionId);
      const operationId = typeof record.operationId === 'string' ? record.operationId : '';
      if (
        !operationId ||
        !Number.isSafeInteger(questionId) ||
        questionId <= 0 ||
        typeof record.flagged !== 'boolean'
      ) continue;
      safe[key] = { operationId, questionId, flagged: record.flagged };
    }
    return safe;
  } catch {
    return {};
  }
}

function persistPendingWrites(sessionId: string, writes: PersistedFlagWrites): void {
  if (typeof window === 'undefined' || !sessionId) return;
  try {
    const key = storageKey(sessionId);
    if (Object.keys(writes).length === 0) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(writes));
  } catch {
    // Recovery storage is best-effort. The server remains authoritative.
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof ExamGatewayError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  if (error instanceof Error) {
    return error.name === 'AbortError' || error.name === 'TimeoutError' || /network|fetch/i.test(error.message);
  }
  return false;
}

export function useExamFlagPersistence(options: {
  sessionId: string;
  initialFlaggedQuestionIds?: number[];
}) {
  const { sessionId, initialFlaggedQuestionIds = [] } = options;
  const pendingWritesRef = useRef<PersistedFlagWrites>(loadPendingWrites(sessionId));
  const saveChainsRef = useRef<Record<number, Promise<void>>>({});
  const persistedFlaggedQuestionIdsRef = useRef(new Set(initialFlaggedQuestionIds));
  const [flaggedQuestionIds, setFlaggedQuestionIds] = useState<Set<number>>(
    () => new Set(initialFlaggedQuestionIds),
  );
  const [savingQuestionIds, setSavingQuestionIds] = useState<Set<number>>(new Set());
  const [failedQuestionIds, setFailedQuestionIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const applyDesired = useCallback((questionId: number, flagged: boolean) => {
    setFlaggedQuestionIds((previous) => {
      const next = new Set(previous);
      if (flagged) next.add(questionId);
      else next.delete(questionId);
      return next;
    });
  }, []);

  const setSaving = useCallback((questionId: number, saving: boolean) => {
    setSavingQuestionIds((previous) => {
      const next = new Set(previous);
      if (saving) next.add(questionId);
      else next.delete(questionId);
      return next;
    });
  }, []);

  const setFailed = useCallback((questionId: number, failed: boolean) => {
    setFailedQuestionIds((previous) => {
      if (previous.has(questionId) === failed) return previous;
      const next = new Set(previous);
      if (failed) next.add(questionId);
      else next.delete(questionId);
      return next;
    });
  }, []);

  const persistLatest = useCallback((write: PendingFlagWrite) => {
    pendingWritesRef.current = {
      ...pendingWritesRef.current,
      [String(write.questionId)]: write,
    };
    persistPendingWrites(sessionId, pendingWritesRef.current);
    setFailed(write.questionId, false);
  }, [sessionId, setFailed]);

  const clearIfCurrent = useCallback((write: PendingFlagWrite): boolean => {
    const current = pendingWritesRef.current[String(write.questionId)];
    if (!current || current.operationId !== write.operationId) return false;
    const next = { ...pendingWritesRef.current };
    delete next[String(write.questionId)];
    pendingWritesRef.current = next;
    persistPendingWrites(sessionId, next);
    return true;
  }, [sessionId]);

  const executeWrite = useCallback(async (write: PendingFlagWrite): Promise<void> => {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= MAX_SAVE_ATTEMPTS; attempt += 1) {
      try {
        await setQuestionFlagDirect(write.questionId, write.flagged);
        if (clearIfCurrent(write)) {
          const persisted = new Set(persistedFlaggedQuestionIdsRef.current);
          if (write.flagged) persisted.add(write.questionId);
          else persisted.delete(write.questionId);
          persistedFlaggedQuestionIdsRef.current = persisted;
          setFailed(write.questionId, false);
          setError(null);
        }
        return;
      } catch (saveError) {
        lastError = saveError;
        if (attempt >= MAX_SAVE_ATTEMPTS || !isRetryable(saveError)) break;
      }
    }

    const current = pendingWritesRef.current[String(write.questionId)];
    if (current?.operationId === write.operationId) {
      setFailed(write.questionId, true);
      setError(lastError instanceof Error ? lastError.message : 'Unable to update the question flag.');
    }
    throw lastError instanceof Error ? lastError : new Error('Unable to update the question flag.');
  }, [clearIfCurrent, setFailed]);

  const enqueue = useCallback((write: PendingFlagWrite): Promise<void> => {
    persistLatest(write);
    applyDesired(write.questionId, write.flagged);
    setSaving(write.questionId, true);

    const previous = saveChainsRef.current[write.questionId] || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => executeWrite(write))
      .finally(() => {
        if (saveChainsRef.current[write.questionId] === next) {
          delete saveChainsRef.current[write.questionId];
          setSaving(write.questionId, false);
        }
      });
    saveChainsRef.current[write.questionId] = next;
    return next;
  }, [applyDesired, executeWrite, persistLatest, setSaving]);

  const hydrate = useCallback((questionIds: number[]) => {
    const serverState = new Set(questionIds);
    persistedFlaggedQuestionIdsRef.current = new Set(serverState);
    for (const pending of Object.values(pendingWritesRef.current)) {
      if (pending.flagged) serverState.add(pending.questionId);
      else serverState.delete(pending.questionId);
    }
    setFlaggedQuestionIds(serverState);
    setError(null);
  }, []);

  const toggle = useCallback((questionId: number) => {
    const nextFlagged = !flaggedQuestionIds.has(questionId);
    const write: PendingFlagWrite = {
      operationId: crypto.randomUUID(),
      questionId,
      flagged: nextFlagged,
    };
    void enqueue(write).catch(() => undefined);
  }, [enqueue, flaggedQuestionIds]);

  const retryPending = useCallback((questionId: number): Promise<void> => {
    const pending = pendingWritesRef.current[String(questionId)];
    if (!pending) return Promise.reject(new Error('No pending flag update is available to retry.'));
    return enqueue(pending);
  }, [enqueue]);

  const drain = useCallback(async () => {
    const active = Object.values(saveChainsRef.current);
    if (active.length > 0) await Promise.all(active);
    const unresolved = Object.values(pendingWritesRef.current);
    if (unresolved.length > 0) await Promise.all(unresolved.map((write) => enqueue(write)));
  }, [enqueue]);

  useEffect(() => {
    pendingWritesRef.current = loadPendingWrites(sessionId);
    for (const pending of Object.values(pendingWritesRef.current)) {
      applyDesired(pending.questionId, pending.flagged);
    }
    if (Object.keys(pendingWritesRef.current).length === 0) return;
    void Promise.allSettled(Object.values(pendingWritesRef.current).map((write) => enqueue(write)));
  }, [applyDesired, enqueue, sessionId]);

  return {
    flaggedQuestionIds,
    savingQuestionIds,
    failedQuestionIds,
    error,
    clearError: () => setError(null),
    hydrate,
    toggle,
    retryPending,
    drain,
  };
}

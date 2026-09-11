'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { submitExamAnswerDirect } from '@/lib/exam-client-api';
import { ExamGatewayError } from '@/lib/exam-gateway-client';
import type { ExamClientAnswer } from '@/types/exam';

type PendingWrite = {
  requestId: string;
  questionId: number;
  selectedOptionId: number;
  timeSpentSeconds: number;
};

type PersistedPendingWrites = Record<string, PendingWrite>;

const MAX_SAVE_ATTEMPTS = 2;

function storageKey(sessionId: string): string {
  return `royal.exam.pending-answers:${sessionId}`;
}

function loadPendingWrites(sessionId: string): PersistedPendingWrites {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(storageKey(sessionId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const safe: PersistedPendingWrites = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const record = value as Record<string, unknown>;
      const questionId = Number(record.questionId);
      const selectedOptionId = Number(record.selectedOptionId);
      const timeSpentSeconds = Number(record.timeSpentSeconds);
      const requestId = typeof record.requestId === 'string' ? record.requestId : '';
      if (
        !requestId ||
        !Number.isSafeInteger(questionId) || questionId <= 0 ||
        !Number.isSafeInteger(selectedOptionId) || selectedOptionId <= 0 ||
        !Number.isFinite(timeSpentSeconds) || timeSpentSeconds < 0
      ) {
        continue;
      }
      safe[key] = {
        requestId,
        questionId,
        selectedOptionId,
        timeSpentSeconds: Math.floor(timeSpentSeconds),
      };
    }
    return safe;
  } catch {
    return {};
  }
}

function persistPendingWrites(sessionId: string, writes: PersistedPendingWrites): void {
  if (typeof window === 'undefined') return;
  try {
    const key = storageKey(sessionId);
    if (Object.keys(writes).length === 0) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(writes));
  } catch {
    // Recovery storage is a safety net only. Server idempotency remains the source of truth.
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

export function useExamAnswerWriteQueue(options: {
  sessionId: string;
  disabled?: boolean;
  onConfirmed?: (answer: ExamClientAnswer) => void;
}) {
  const { sessionId, disabled = false, onConfirmed } = options;
  const chainsRef = useRef<Record<number, Promise<ExamClientAnswer>>>({});
  const pendingWritesRef = useRef<PersistedPendingWrites>({});
  const [savingQuestionIds, setSavingQuestionIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const setSaving = useCallback((questionId: number, saving: boolean) => {
    setSavingQuestionIds((previous) => {
      const next = new Set(previous);
      if (saving) next.add(questionId);
      else next.delete(questionId);
      return next;
    });
  }, []);

  const persistLatest = useCallback((write: PendingWrite) => {
    pendingWritesRef.current = {
      ...pendingWritesRef.current,
      [String(write.questionId)]: write,
    };
    persistPendingWrites(sessionId, pendingWritesRef.current);
  }, [sessionId]);

  const clearIfCurrent = useCallback((write: PendingWrite) => {
    const current = pendingWritesRef.current[String(write.questionId)];
    if (!current || current.requestId !== write.requestId) return;
    const next = { ...pendingWritesRef.current };
    delete next[String(write.questionId)];
    pendingWritesRef.current = next;
    persistPendingWrites(sessionId, next);
  }, [sessionId]);

  const executeWrite = useCallback(async (write: PendingWrite): Promise<ExamClientAnswer> => {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= MAX_SAVE_ATTEMPTS; attempt += 1) {
      try {
        const answer = await submitExamAnswerDirect({
          requestId: write.requestId,
          sessionId,
          questionId: write.questionId,
          selectedOptionId: write.selectedOptionId,
          timeSpentSeconds: write.timeSpentSeconds,
        });
        clearIfCurrent(write);
        setError(null);
        onConfirmed?.(answer);
        return answer;
      } catch (saveError) {
        lastError = saveError;
        if (attempt >= MAX_SAVE_ATTEMPTS || !isRetryable(saveError)) break;
      }
    }

    const message = lastError instanceof Error ? lastError.message : 'Unable to save the answer.';
    setError(message);
    throw lastError instanceof Error ? lastError : new Error(message);
  }, [clearIfCurrent, onConfirmed, sessionId]);

  const enqueue = useCallback((input: {
    questionId: number;
    selectedOptionId: number;
    timeSpentSeconds: number;
    requestId?: string;
  }): Promise<ExamClientAnswer> => {
    if (disabled) return Promise.reject(new Error('Answer saving is disabled.'));

    const write: PendingWrite = {
      requestId: input.requestId || crypto.randomUUID(),
      questionId: input.questionId,
      selectedOptionId: input.selectedOptionId,
      timeSpentSeconds: Math.max(0, Math.floor(input.timeSpentSeconds)),
    };
    persistLatest(write);
    setSaving(write.questionId, true);

    const previous = chainsRef.current[write.questionId] || Promise.resolve(null as unknown as ExamClientAnswer);
    const next = previous
      .catch(() => null as unknown as ExamClientAnswer)
      .then(() => executeWrite(write))
      .finally(() => {
        if (chainsRef.current[write.questionId] === next) {
          delete chainsRef.current[write.questionId];
          setSaving(write.questionId, false);
        }
      });

    chainsRef.current[write.questionId] = next;
    return next;
  }, [disabled, executeWrite, persistLatest, setSaving]);

  const drain = useCallback(async () => {
    const active = Object.values(chainsRef.current);
    if (active.length > 0) await Promise.all(active);

    const unresolved = Object.values(pendingWritesRef.current);
    if (unresolved.length > 0) {
      await Promise.all(unresolved.map((write) => enqueue(write)));
    }
  }, [enqueue]);

  useEffect(() => {
    if (disabled) return;
    pendingWritesRef.current = loadPendingWrites(sessionId);
    const pending = Object.values(pendingWritesRef.current);
    if (pending.length === 0) return;

    // Reconcile an ACK that may have been lost during refresh/navigation. The
    // same request id is reused, so a committed Standard/Tutor answer is returned
    // rather than submitted a second time.
    void Promise.allSettled(pending.map((write) => enqueue(write)));
  }, [disabled, enqueue, sessionId]);

  return {
    savingQuestionIds,
    error,
    clearError: () => setError(null),
    enqueue,
    drain,
  };
}

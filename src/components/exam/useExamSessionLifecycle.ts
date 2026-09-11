'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { completeExamSessionDirect } from '@/lib/exam-client-api';

export function useExamSessionLifecycle(options: {
  sessionId: string;
  bankId: number;
  isReviewMode: boolean;
  isCountdownSession: boolean;
  deadlineAtMs: number | null;
  serverClockOffsetMs: number;
  flushAnnotations: () => Promise<void>;
  drainAnswers: () => Promise<void>;
  drainFlags: () => Promise<void>;
}) {
  const {
    sessionId,
    bankId,
    isReviewMode,
    isCountdownSession,
    deadlineAtMs,
    serverClockOffsetMs,
    flushAnnotations,
    drainAnswers,
    drainFlags,
  } = options;
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoSubmitStartedRef = useRef(false);
  const closingRef = useRef(false);

  const exitTarget = bankId > 0 ? `/bank/${bankId}/sessions` : '/dashboard';

  const beginClosing = useCallback(() => {
    closingRef.current = true;
    setIsSubmitting(true);
    setError(null);
  }, []);

  const reopenAfterFailure = useCallback(() => {
    closingRef.current = false;
    setIsSubmitting(false);
  }, []);

  const handleSuspend = useCallback(async () => {
    if (isReviewMode) {
      try {
        await flushAnnotations();
        router.push(exitTarget);
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : 'Unable to save annotations before leaving review.');
      }
      return;
    }

    if (!window.confirm('Suspend this block and return later?')) return;

    beginClosing();
    try {
      await flushAnnotations();
      await drainAnswers();
      await drainFlags();
      router.push(exitTarget);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to suspend the block safely.');
      reopenAfterFailure();
    }
  }, [beginClosing, drainAnswers, drainFlags, exitTarget, flushAnnotations, isReviewMode, reopenAfterFailure, router]);

  const handleEndBlock = useCallback(async (forceSubmit = false) => {
    if (isReviewMode) {
      try {
        await flushAnnotations();
        router.push(exitTarget);
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : 'Unable to save annotations before leaving review.');
      }
      return;
    }

    if (!forceSubmit && !window.confirm('End this block? Unanswered questions will be finalized.')) {
      return;
    }

    beginClosing();
    try {
      await flushAnnotations();
      await drainAnswers();
      await drainFlags();
      await completeExamSessionDirect(sessionId);
      router.push(exitTarget);
    } catch (saveError) {
      if (forceSubmit) autoSubmitStartedRef.current = false;
      setError(saveError instanceof Error ? saveError.message : 'Unable to complete the block.');
      reopenAfterFailure();
    }
  }, [beginClosing, drainAnswers, drainFlags, exitTarget, flushAnnotations, isReviewMode, reopenAfterFailure, router, sessionId]);

  useEffect(() => {
    if (isReviewMode || !isCountdownSession || deadlineAtMs == null) return;

    let timeoutId: number | null = null;
    const checkDeadline = () => {
      const remainingMs = deadlineAtMs - (Date.now() + serverClockOffsetMs);
      if (remainingMs <= 0) {
        if (!closingRef.current && !autoSubmitStartedRef.current) {
          autoSubmitStartedRef.current = true;
          void handleEndBlock(true);
        }
        return;
      }
      timeoutId = window.setTimeout(checkDeadline, Math.min(remainingMs, 60_000));
    };

    const initialId = window.setTimeout(checkDeadline, 0);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkDeadline();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearTimeout(initialId);
      if (timeoutId != null) window.clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [deadlineAtMs, handleEndBlock, isCountdownSession, isReviewMode, serverClockOffsetMs]);

  return {
    isSubmitting,
    closingRef,
    error,
    clearError: () => setError(null),
    handleSuspend,
    handleEndBlock,
  };
}

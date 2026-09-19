'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  completeExamSessionDirect,
  suspendExamSessionBestEffort,
  suspendExamSessionDirect,
} from '@/lib/exam-client-api';

type PendingLeave =
  | { kind: 'url'; href: string }
  | { kind: 'back' };

export function useExamSessionLifecycle(options: {
  sessionId: string;
  bankId: number;
  isReviewMode: boolean;
  isSessionReady: boolean;
  isCountdownSession: boolean;
  deadlineAtMs: number | null;
  serverClockOffsetMs: number;
  flushAnnotations: () => Promise<void>;
  drainAnswers: () => Promise<void>;
  drainFlags: () => Promise<void>;
  canBestEffortSuspend: boolean;
}) {
  const {
    sessionId,
    bankId,
    isReviewMode,
    isSessionReady,
    isCountdownSession,
    deadlineAtMs,
    serverClockOffsetMs,
    flushAnnotations,
    drainAnswers,
    drainFlags,
    canBestEffortSuspend,
  } = options;
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leavePromptOpen, setLeavePromptOpen] = useState(false);
  const autoSubmitStartedRef = useRef(false);
  const closingRef = useRef(false);
  const pendingLeaveRef = useRef<PendingLeave | null>(null);
  const allowHistoryNavigationRef = useRef(false);
  const canBestEffortSuspendRef = useRef(canBestEffortSuspend);

  useEffect(() => {
    canBestEffortSuspendRef.current = canBestEffortSuspend;
  }, [canBestEffortSuspend]);

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

  const requestLeave = useCallback((pending: PendingLeave) => {
    if (closingRef.current || isReviewMode) return;
    pendingLeaveRef.current = pending;
    setLeavePromptOpen(true);
  }, [isReviewMode]);

  const cancelLeave = useCallback(() => {
    pendingLeaveRef.current = null;
    setLeavePromptOpen(false);
  }, []);

  const navigateAfterSuspend = useCallback((pending: PendingLeave) => {
    if (pending.kind === 'back') {
      allowHistoryNavigationRef.current = true;
      if (window.history.length > 2) {
        window.history.go(-2);
      } else {
        router.push(exitTarget);
      }
      return;
    }

    const target = new URL(pending.href, window.location.href);
    if (target.origin === window.location.origin) {
      router.push(`${target.pathname}${target.search}${target.hash}`);
    } else {
      window.location.assign(target.href);
    }
  }, [exitTarget, router]);

  const confirmLeave = useCallback(async () => {
    const pending = pendingLeaveRef.current;
    if (!pending || closingRef.current) return;

    pendingLeaveRef.current = null;
    setLeavePromptOpen(false);
    beginClosing();

    try {
      await flushAnnotations();
      await drainAnswers();
      await drainFlags();
      await suspendExamSessionDirect(sessionId);
      navigateAfterSuspend(pending);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to suspend the block safely.');
      reopenAfterFailure();
    }
  }, [
    beginClosing,
    drainAnswers,
    drainFlags,
    flushAnnotations,
    navigateAfterSuspend,
    reopenAfterFailure,
    sessionId,
  ]);

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

    requestLeave({ kind: 'url', href: exitTarget });
  }, [exitTarget, flushAnnotations, isReviewMode, requestLeave, router]);

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
    if (isReviewMode || !isSessionReady) return;

    const historyGuardKey = '__royal_exam_leave_guard';
    const guardState = {
      ...(window.history.state && typeof window.history.state === 'object'
        ? window.history.state
        : {}),
      [historyGuardKey]: sessionId,
    };
    window.history.pushState(guardState, '', window.location.href);

    const onPopState = () => {
      if (allowHistoryNavigationRef.current) {
        allowHistoryNavigationRef.current = false;
        return;
      }
      if (closingRef.current) return;

      window.history.pushState(guardState, '', window.location.href);
      requestLeave({ kind: 'back' });
    };

    const onDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        closingRef.current
      ) {
        return;
      }

      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;

      const target = new URL(anchor.href, window.location.href);
      const current = new URL(window.location.href);
      const sameDocument =
        target.origin === current.origin &&
        target.pathname === current.pathname &&
        target.search === current.search;
      if (sameDocument) return;

      event.preventDefault();
      event.stopPropagation();
      requestLeave({ kind: 'url', href: target.href });
    };

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (closingRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };

    const onPageHide = () => {
      if (closingRef.current || !canBestEffortSuspendRef.current) return;
      suspendExamSessionBestEffort(sessionId);
    };

    window.addEventListener('popstate', onPopState);
    document.addEventListener('click', onDocumentClick, true);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      window.removeEventListener('popstate', onPopState);
      document.removeEventListener('click', onDocumentClick, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [isReviewMode, isSessionReady, requestLeave, sessionId]);

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
    leavePromptOpen,
    confirmLeave,
    cancelLeave,
    handleSuspend,
    handleEndBlock,
  };
}

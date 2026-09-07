'use client';

import { useEffect, useState } from 'react';
import {
  EXAM_RATE_LIMIT_EVENT,
  EXAM_RATE_LIMIT_STORAGE_KEY,
} from '@/lib/exam-gateway-client';

type RateLimitEventDetail = {
  retryAt?: number;
};

function formatCountdown(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function ExamRateLimitNotice() {
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  useEffect(() => {
    const loadStoredDeadline = () => {
      try {
        const stored = Number(window.sessionStorage.getItem(EXAM_RATE_LIMIT_STORAGE_KEY) || 0);
        if (Number.isFinite(stored) && stored > Date.now()) {
          setRetryAt(stored);
          return;
        }
        window.sessionStorage.removeItem(EXAM_RATE_LIMIT_STORAGE_KEY);
      } catch {
        // Storage is optional; the live event below still keeps the UI useful.
      }
    };

    const handleRateLimit = (event: Event) => {
      const detail = (event as CustomEvent<RateLimitEventDetail>).detail;
      const nextRetryAt = Number(detail?.retryAt || 0);
      if (Number.isFinite(nextRetryAt) && nextRetryAt > Date.now()) {
        setRetryAt(nextRetryAt);
      }
    };

    loadStoredDeadline();
    window.addEventListener(EXAM_RATE_LIMIT_EVENT, handleRateLimit);

    return () => {
      window.removeEventListener(EXAM_RATE_LIMIT_EVENT, handleRateLimit);
    };
  }, []);

  useEffect(() => {
    if (!retryAt) return;

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      setRemainingSeconds(remaining);

      if (remaining === 0) {
        try {
          window.sessionStorage.removeItem(EXAM_RATE_LIMIT_STORAGE_KEY);
        } catch {
          // Nothing else to do.
        }
        setRetryAt(null);
      }
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  if (!retryAt || remainingSeconds <= 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-4 z-[120] flex justify-center px-4"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="w-full max-w-[440px] rounded-[6px] border border-[#caa45a] bg-[#332d22]/95 px-4 py-3 text-white shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-sm">
        <div className="flex items-center justify-between gap-4">
          <span className="text-[13px] font-semibold">Request limit reached</span>
          <span className="font-mono text-[16px] font-semibold tabular-nums text-[#ffe1a3]">
            {formatCountdown(remainingSeconds)}
          </span>
        </div>
        <p className="mt-1.5 text-[12px] leading-5 text-[#f0e7d6]">
          Requests are temporarily paused to protect the question bank. You can try again when the timer reaches zero.
        </p>
      </div>
    </div>
  );
}

'use client';

import React, { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { formatTime } from '@/lib/utils';

export const ExamClock = React.memo(function ExamClock({
  startedAtMs,
  deadlineAtMs,
  serverClockOffsetMs,
}: {
  startedAtMs: number | null;
  deadlineAtMs: number | null;
  serverClockOffsetMs: number;
}) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const update = () => {
      const now = Date.now() + serverClockOffsetMs;
      if (deadlineAtMs != null) {
        setSeconds(Math.max(0, Math.ceil((deadlineAtMs - now) / 1000)));
        return;
      }
      if (startedAtMs != null) {
        setSeconds(Math.max(0, Math.floor((now - startedAtMs) / 1000)));
        return;
      }
      setSeconds(0);
    };

    const initialId = window.setTimeout(update, 0);
    const intervalId = window.setInterval(update, 1000);
    return () => {
      window.clearTimeout(initialId);
      window.clearInterval(intervalId);
    };
  }, [deadlineAtMs, serverClockOffsetMs, startedAtMs]);

  return (
    <div className="inline-flex h-[30px] shrink-0 items-center gap-2 rounded-[4px] border border-[#5a5f64] bg-[#363636] px-3 text-[12px] text-[#eaeaea]">
      <Clock3 className="h-3.5 w-3.5 text-[#a7adb3]" />
      <span className="font-mono">{formatTime(seconds)}</span>
    </div>
  );
});

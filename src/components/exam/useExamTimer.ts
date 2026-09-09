'use client';

import { useEffect, useState } from 'react';

export function useExamTimer({
  isTimedMode,
  timeLimitSeconds,
  isSubmitting,
  onTimeExpired,
}: {
  isTimedMode: boolean;
  timeLimitSeconds: number;
  isSubmitting: boolean;
  onTimeExpired: () => void;
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setElapsedSeconds((value) => {
        const nextValue = value + 1;
        if (
          isTimedMode &&
          timeLimitSeconds > 0 &&
          nextValue >= timeLimitSeconds &&
          !isSubmitting
        ) {
          window.clearInterval(timerId);
          onTimeExpired();
        }
        return nextValue;
      });
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [isSubmitting, isTimedMode, onTimeExpired, timeLimitSeconds]);

  return elapsedSeconds;
}

'use client';

export function examDiagnosticsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ROYAL_EXAM_DIAGNOSTICS === 'true';
}

export function logExamClientMetric(
  event: string,
  fields: Record<string, string | number | boolean | null | undefined>,
): void {
  if (!examDiagnosticsEnabled() || typeof window === 'undefined') return;
  const payload = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
  console.info('[royal-exam-client]', JSON.stringify({ event, ...payload }));
}

export function logExamAfterNextPaint(
  event: string,
  startedAtMs: number,
  fields: Record<string, string | number | boolean | null | undefined> = {},
): void {
  if (!examDiagnosticsEnabled() || typeof window === 'undefined') return;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      logExamClientMetric(event, {
        ...fields,
        duration_ms: Number((performance.now() - startedAtMs).toFixed(1)),
      });
    });
  });
}

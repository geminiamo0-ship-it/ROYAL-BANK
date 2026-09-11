import type { ExamBootstrap, ExamClientQuestion } from '@/types/exam';

type CachedExamLaunch = {
  bootstrap: ExamBootstrap;
  questionsById: Record<number, ExamClientQuestion>;
  pendingWindow: Promise<ExamClientQuestion[]> | null;
};

const launchCache = new Map<string, CachedExamLaunch>();

export function primeExamLaunchCache(bootstrap: ExamBootstrap) {
  const questionsById: Record<number, ExamClientQuestion> = {};
  for (const question of bootstrap.questions) {
    questionsById[question.id] = question;
  }

  launchCache.set(bootstrap.session.id, {
    bootstrap,
    questionsById,
    pendingWindow: null,
  });
}

export function mergeExamLaunchWindow(sessionId: string, questions: ExamClientQuestion[]) {
  const cached = launchCache.get(sessionId);
  if (!cached) return;

  for (const question of questions) {
    cached.questionsById[question.id] = question;
  }
}

export function trackExamLaunchWindow(
  sessionId: string,
  pendingWindow: Promise<ExamClientQuestion[]>,
): void {
  const cached = launchCache.get(sessionId);
  if (!cached) return;
  cached.pendingWindow = pendingWindow;
}

/**
 * One-shot handoff between the bank screen and exam route. The in-flight window
 * promise is part of the handoff, so consuming the cache cannot make a late
 * prefetch result disappear.
 */
export function getExamLaunchCache(sessionId: string): CachedExamLaunch | null {
  const cached = launchCache.get(sessionId);
  if (!cached) return null;

  launchCache.delete(sessionId);
  return cached;
}

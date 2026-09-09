import type { ExamBootstrap, ExamClientQuestion } from '@/types/exam';

type CachedExamLaunch = {
  bootstrap: ExamBootstrap;
  questionsById: Record<number, ExamClientQuestion>;
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
  });
}

export function mergeExamLaunchWindow(sessionId: string, questions: ExamClientQuestion[]) {
  const cached = launchCache.get(sessionId);
  if (!cached) return;

  for (const question of questions) {
    cached.questionsById[question.id] = question;
  }
}

/**
 * The launch cache is a one-shot handoff between the question-bank screen and
 * the exam route. Consuming it prevents stale bootstrap state from being reused
 * if the same session is revisited later in the SPA lifetime.
 */
export function getExamLaunchCache(sessionId: string): CachedExamLaunch | null {
  const cached = launchCache.get(sessionId);
  if (!cached) return null;

  launchCache.delete(sessionId);
  return cached;
}

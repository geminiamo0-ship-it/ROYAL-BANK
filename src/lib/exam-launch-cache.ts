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

export function getExamLaunchCache(sessionId: string): CachedExamLaunch | null {
  return launchCache.get(sessionId) || null;
}

export function clearExamLaunchCache(sessionId: string) {
  launchCache.delete(sessionId);
}

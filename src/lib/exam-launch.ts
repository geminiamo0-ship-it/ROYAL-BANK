'use client';

import {
  createExamSessionBootstrap,
  getExamSessionWindowDirect,
} from '@/lib/exam-client-api';
import {
  mergeExamLaunchWindow,
  primeExamLaunchCache,
} from '@/lib/exam-launch-cache';
import type { StartExamInput } from '@/types/exam';

export async function startExamSession(input: StartExamInput): Promise<string> {
  const bootstrap = await createExamSessionBootstrap(input);
  if (bootstrap.status !== 'active') throw new Error('Exam session was not created as active.');

  const sessionId = bootstrap.session.id;
  primeExamLaunchCache(bootstrap);

  // Do not block navigation on the look-ahead buffer. Q1 is already in the create RPC;
  // Q2 + Q3 are fetched directly from Supabase while Next.js starts the route transition.
  const nextStart = Math.min(bootstrap.currentIndex + 1, bootstrap.questionIds.length);
  if (nextStart < bootstrap.questionIds.length) {
    void getExamSessionWindowDirect(sessionId, nextStart, 2)
      .then((questions) => mergeExamLaunchWindow(sessionId, questions))
      .catch(() => undefined);
  }

  return sessionId;
}

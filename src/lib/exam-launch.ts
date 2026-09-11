'use client';

import {
  createExamSessionBootstrap,
  getExamSessionWindowDirect,
} from '@/lib/exam-client-api';
import {
  mergeExamLaunchWindow,
  primeExamLaunchCache,
  trackExamLaunchWindow,
} from '@/lib/exam-launch-cache';
import type { StartExamInput } from '@/types/exam';

export async function startExamSession(input: StartExamInput): Promise<string> {
  const bootstrap = await createExamSessionBootstrap(input);
  if (bootstrap.status !== 'active') throw new Error('Exam session was not created as active.');

  const sessionId = bootstrap.session.id;
  primeExamLaunchCache(bootstrap);

  // Q1 is already in the create RPC. Hand the in-flight Q2/Q3 promise to the
  // exam controller so a fast route transition cannot consume the cache before
  // the prefetch resolves.
  const nextStart = Math.min(bootstrap.currentIndex + 1, bootstrap.questionIds.length);
  if (nextStart < bootstrap.questionIds.length) {
    const pendingWindow = getExamSessionWindowDirect(
      sessionId,
      nextStart,
      2,
      bootstrap.windowAccessToken,
    )
      .then((questions) => {
        mergeExamLaunchWindow(sessionId, questions);
        return questions;
      })
      .catch(() => []);

    trackExamLaunchWindow(sessionId, pendingWindow);
  }

  return sessionId;
}

'use server';

import {
  completeStudyPlanTask,
  createStudyPlanRecord,
  linkStudyPlanSession,
  rebalanceStudyPlanRecord,
  StudyPlanAccessError,
  StudyPlanAuthenticationError,
  StudyPlanValidationError,
  type StudyPlanMissedStrategy,
  type StudyPlanSettingsInput,
  updateStudyPlanRecord,
} from '@/lib/study-plan';

export type StudyPlanActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: 'AUTH_REQUIRED' | 'ACCESS_DENIED' | 'INVALID' | 'FAILED';
      message: string;
    };

function failure(error: unknown): StudyPlanActionResult<never> {
  if (error instanceof StudyPlanAuthenticationError) {
    return { ok: false, code: 'AUTH_REQUIRED', message: error.message };
  }
  if (error instanceof StudyPlanAccessError) {
    return { ok: false, code: 'ACCESS_DENIED', message: error.message };
  }
  if (error instanceof StudyPlanValidationError) {
    return { ok: false, code: 'INVALID', message: error.message };
  }
  return { ok: false, code: 'FAILED', message: 'Unable to update your study plan.' };
}

export async function createStudyPlanAction(
  bankId: number,
  input: StudyPlanSettingsInput,
): Promise<StudyPlanActionResult<{ planId: string }>> {
  try {
    const planId = await createStudyPlanRecord(bankId, input);
    return { ok: true, data: { planId } };
  } catch (error) {
    return failure(error);
  }
}

export async function updateStudyPlanAction(
  planId: string,
  input: StudyPlanSettingsInput,
): Promise<StudyPlanActionResult> {
  try {
    await updateStudyPlanRecord(planId, input);
    return { ok: true, data: undefined };
  } catch (error) {
    return failure(error);
  }
}

export async function markStudyPlanTaskCompleteAction(
  taskId: number,
): Promise<StudyPlanActionResult> {
  try {
    await completeStudyPlanTask(taskId);
    return { ok: true, data: undefined };
  } catch (error) {
    return failure(error);
  }
}

export async function linkStudyPlanSessionAction(
  taskId: number,
  sessionId: string,
): Promise<StudyPlanActionResult> {
  try {
    await linkStudyPlanSession(taskId, sessionId);
    return { ok: true, data: undefined };
  } catch (error) {
    return failure(error);
  }
}

export async function rebalanceStudyPlanAction(
  planId: string,
  strategy?: StudyPlanMissedStrategy,
): Promise<StudyPlanActionResult<{ strategy: StudyPlanMissedStrategy; moved: number; fallback: boolean }>> {
  try {
    const data = await rebalanceStudyPlanRecord(planId, strategy);
    return { ok: true, data };
  } catch (error) {
    return failure(error);
  }
}

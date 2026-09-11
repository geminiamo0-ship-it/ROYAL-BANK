import 'server-only';

import { hydrateExamR2QuestionIds } from '@/lib/exam-r2-content';
import {
  issueExamWindowAccessToken,
  verifyExamWindowAccessToken,
  type ExamWindowAccessMode,
} from '@/lib/exam-window-access';
import type { ExamGatewayAction } from '@/types/exam-gateway';

export const EXAM_WINDOW_ACCESS_HEADER = 'x-royal-window-access';

type JsonObject = Record<string, unknown>;

type WindowArgs = {
  p_session_id: string;
  p_start: number;
  p_count: number;
};

type ActiveWindowGuardResult = {
  ok: boolean;
  status: number;
  rawBody: string;
};

function asObject(value: unknown): JsonObject | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function questionIdsFrom(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.map(Number);
  return ids.every((id) => Number.isSafeInteger(id) && id > 0) ? ids : null;
}

function modeForWindowAction(action: ExamGatewayAction): ExamWindowAccessMode | null {
  if (action === 'window') return 'active';
  if (action === 'reviewWindow') return 'review';
  return null;
}

function modeForBootstrapAction(action: ExamGatewayAction): ExamWindowAccessMode | null {
  if (action === 'create' || action === 'bootstrap') return 'active';
  if (action === 'reviewBootstrap') return 'review';
  return null;
}

function authorizedIdsFromGuard(rawBody: string): number[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;
  const ids: number[] = [];
  for (const item of parsed) {
    const record = asObject(item);
    const id = Number(record?.id);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    ids.push(id);
  }
  return ids;
}

function selectAuthorizedHydratedQuestions(
  hydratedBody: string,
  requestedIds: number[],
  authorizedIds: number[],
): string | null {
  if (authorizedIds.length > requestedIds.length) return null;

  for (let index = 0; index < authorizedIds.length; index += 1) {
    if (authorizedIds[index] !== requestedIds[index]) return null;
  }

  let hydrated: unknown;
  try {
    hydrated = JSON.parse(hydratedBody) as unknown;
  } catch {
    return null;
  }
  if (!Array.isArray(hydrated) || hydrated.length !== requestedIds.length) return null;

  const allowed = hydrated.slice(0, authorizedIds.length);
  for (let index = 0; index < allowed.length; index += 1) {
    const record = asObject(allowed[index]);
    if (Number(record?.id) !== authorizedIds[index]) return null;
  }

  return JSON.stringify(allowed);
}

export async function trySignedExamWindowFastPath(options: {
  request: Request;
  action: ExamGatewayAction;
  args: Record<string, unknown>;
  userId: string;
  secret: string;
  authorizeActiveWindow?: () => Promise<ActiveWindowGuardResult>;
}): Promise<string | null> {
  const mode = modeForWindowAction(options.action);
  if (!mode) return null;

  const token = options.request.headers.get(EXAM_WINDOW_ACCESS_HEADER)?.trim() || '';
  if (!token) return null;

  const args = options.args as Partial<WindowArgs>;
  if (
    typeof args.p_session_id !== 'string' ||
    typeof args.p_start !== 'number' ||
    !Number.isSafeInteger(args.p_start) ||
    args.p_start < 0 ||
    typeof args.p_count !== 'number' ||
    !Number.isSafeInteger(args.p_count) ||
    args.p_count < 1 ||
    args.p_count > 5
  ) {
    return null;
  }

  const access = verifyExamWindowAccessToken({
    token,
    userId: options.userId,
    sessionId: args.p_session_id,
    mode,
    secret: options.secret,
  });
  if (!access) return null;

  const end = Math.min(args.p_start + args.p_count, access.q.length);
  const questionIds =
    args.p_start >= access.q.length ? [] : access.q.slice(args.p_start, end);

  const totalStart = performance.now();
  let guardMs = 0;
  let contentMs = 0;

  const contentStart = performance.now();
  const contentPromise = hydrateExamR2QuestionIds(
    options.action as 'window' | 'reviewWindow',
    questionIds,
  ).finally(() => {
    contentMs = performance.now() - contentStart;
  });

  let hydrated: string | null;

  if (mode === 'active') {
    if (!options.authorizeActiveWindow) return null;

    const guardStart = performance.now();
    const guardPromise = options.authorizeActiveWindow().finally(() => {
      guardMs = performance.now() - guardStart;
    });

    const [contentBody, guard] = await Promise.all([contentPromise, guardPromise]);
    if (!guard.ok || contentBody == null) return null;

    const authorizedIds = authorizedIdsFromGuard(guard.rawBody);
    if (!authorizedIds) return null;

    hydrated = selectAuthorizedHydratedQuestions(contentBody, questionIds, authorizedIds);
  } else {
    hydrated = await contentPromise;
  }

  if (hydrated != null && process.env.ROYAL_R2_DIAGNOSTICS === 'true') {
    process.stdout.write(
      `[royal-exam-window] fast_path=1 action=${options.action} count=${questionIds.length} guard_ms=${guardMs.toFixed(1)} content_ms=${contentMs.toFixed(1)} total_ms=${(performance.now() - totalStart).toFixed(1)}\n`,
    );
  }

  return hydrated;
}

export function attachExamWindowAccess(options: {
  action: ExamGatewayAction;
  rawBody: string;
  userId: string;
  secret: string;
}): string {
  const mode = modeForBootstrapAction(options.action);
  if (!mode) return options.rawBody;

  let parsed: unknown;
  try {
    parsed = JSON.parse(options.rawBody) as unknown;
  } catch {
    return options.rawBody;
  }

  const bootstrap = asObject(parsed);
  const session = asObject(bootstrap?.session);
  const sessionId = typeof session?.id === 'string' ? session.id : '';
  const questionIds = questionIdsFrom(bootstrap?.question_ids);
  if (!bootstrap || !sessionId || !questionIds) return options.rawBody;

  const access = issueExamWindowAccessToken({
    userId: options.userId,
    sessionId,
    mode,
    questionIds,
    secret: options.secret,
  });
  if (!access) return options.rawBody;

  return JSON.stringify({
    ...bootstrap,
    window_access_token: access.token,
    window_access_expires_at: access.expiresAt,
  });
}

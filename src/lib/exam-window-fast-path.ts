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

export async function trySignedExamWindowFastPath(options: {
  request: Request;
  action: ExamGatewayAction;
  args: Record<string, unknown>;
  userId: string;
  secret: string;
}): Promise<string | null> {
  const mode = modeForWindowAction(options.action);
  if (!mode) return null;

  const token = options.request.headers.get(EXAM_WINDOW_ACCESS_HEADER)?.trim() || '';
  if (!token) return null;

  const args = options.args as Partial<WindowArgs>;
  if (
    typeof args.p_session_id !== 'string' ||
    !Number.isSafeInteger(args.p_start) ||
    Number(args.p_start) < 0 ||
    !Number.isSafeInteger(args.p_count) ||
    Number(args.p_count) < 1 ||
    Number(args.p_count) > 5
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

  const start = Number(args.p_start);
  const end = Math.min(start + Number(args.p_count), access.q.length);
  const questionIds = start >= access.q.length ? [] : access.q.slice(start, end);

  return hydrateExamR2QuestionIds(options.action as 'window' | 'reviewWindow', questionIds);
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

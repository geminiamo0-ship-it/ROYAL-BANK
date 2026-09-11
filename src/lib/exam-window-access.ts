import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

export type ExamWindowAccessMode = 'active' | 'review';

export type ExamWindowAccessPayload = {
  v: 2;
  u: string;
  s: string;
  m: ExamWindowAccessMode;
  q: number[];
  r: string | null;
  e: number;
};

const WINDOW_ACCESS_CONTEXT = 'royal-exam-window-access-v2';
const WINDOW_ACCESS_TTL_SECONDS = 10 * 60;
const MAX_SESSION_QUESTIONS = 70;
const RELEASE_ID_PATTERN = /^[0-9a-f]{64}$/;

function signatureFor(encodedPayload: string, secret: string): Buffer {
  return createHmac('sha256', secret)
    .update(`${WINDOW_ACCESS_CONTEXT}.${encodedPayload}`)
    .digest();
}

function validQuestionIds(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length > MAX_SESSION_QUESTIONS) return false;
  const seen = new Set<number>();
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isSafeInteger(item) || item <= 0 || seen.has(item)) {
      return false;
    }
    seen.add(item);
  }
  return true;
}

function validReleaseId(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && RELEASE_ID_PATTERN.test(value));
}

export function issueExamWindowAccessToken(options: {
  userId: string;
  sessionId: string;
  mode: ExamWindowAccessMode;
  questionIds: number[];
  contentReleaseId: string | null;
  secret: string;
  nowSeconds?: number;
}): { token: string; expiresAt: number } | null {
  if (!options.userId || !options.sessionId || !options.secret) return null;
  if (!validQuestionIds(options.questionIds) || !validReleaseId(options.contentReleaseId)) return null;

  const nowSeconds = Math.floor(options.nowSeconds ?? Date.now() / 1000);
  const expiresAt = nowSeconds + WINDOW_ACCESS_TTL_SECONDS;
  const payload: ExamWindowAccessPayload = {
    v: 2,
    u: options.userId,
    s: options.sessionId,
    m: options.mode,
    q: options.questionIds,
    r: options.contentReleaseId,
    e: expiresAt,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = signatureFor(encodedPayload, options.secret).toString('base64url');

  return {
    token: `${encodedPayload}.${signature}`,
    expiresAt,
  };
}

export function verifyExamWindowAccessToken(options: {
  token: string;
  userId: string;
  sessionId: string;
  mode: ExamWindowAccessMode;
  secret: string;
  nowSeconds?: number;
}): ExamWindowAccessPayload | null {
  if (!options.token || !options.userId || !options.sessionId || !options.secret) return null;

  const parts = options.token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  let suppliedSignature: Buffer;
  try {
    suppliedSignature = Buffer.from(parts[1], 'base64url');
  } catch {
    return null;
  }

  const expectedSignature = signatureFor(parts[0], options.secret);
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    return null;
  }

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as unknown;
  } catch {
    return null;
  }

  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) return null;
  const payload = rawPayload as Partial<ExamWindowAccessPayload>;
  if (payload.v !== 2) return null;
  if (payload.u !== options.userId || payload.s !== options.sessionId || payload.m !== options.mode) {
    return null;
  }
  if (!validQuestionIds(payload.q) || !validReleaseId(payload.r)) return null;
  if (typeof payload.e !== 'number' || !Number.isSafeInteger(payload.e) || payload.e <= 0) {
    return null;
  }

  const nowSeconds = Math.floor(options.nowSeconds ?? Date.now() / 1000);
  if (payload.e <= nowSeconds) return null;

  return payload as ExamWindowAccessPayload;
}

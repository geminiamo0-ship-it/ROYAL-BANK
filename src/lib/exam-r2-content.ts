import 'server-only';

import { isPrivateR2Configured, readPrivateR2Json } from '@/lib/r2-private';
import type { ExamGatewayAction } from '@/types/exam-gateway';

const DEFAULT_ROOT = 'exam-content';
const DEFAULT_LEGACY_PREFIX = 'exam-content/v1';

const R2_RPC_BY_ACTION: Partial<Record<ExamGatewayAction, string>> = {
  // Creation already returns Q1 in full from Postgres. Do not immediately fetch
  // that same question from R2 again; the route handoff can use it as-is.
  bootstrap: 'get_exam_session_bootstrap_ref_v2',
  window: 'get_exam_session_window_refs',
  reviewBootstrap: 'get_completed_exam_review_bootstrap_ref',
  reviewWindow: 'get_completed_exam_review_window_refs',
  feedback: 'get_exam_question_feedback_ref',
  trainingFeedback: 'get_exam_training_feedback_ref',
  submit: 'submit_exam_answer_with_feedback_ref_idempotent',
};

type JsonObject = Record<string, unknown>;

type R2Question = {
  id: number;
  text_html: string;
  category: string;
  topic: string | null;
  difficulty: string;
  notes_id: string | null;
  concept_id: string | null;
  options: Array<{
    id: number;
    question_id: number;
    text_html: string;
    option_order: number;
  }>;
};

type R2Feedback = {
  question_id: number;
  explanation_html: string;
};

function normalizePrefix(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

function contentRoot(): string {
  return normalizePrefix(process.env.ROYAL_R2_CONTENT_ROOT?.trim() || DEFAULT_ROOT);
}

function legacyContentPrefix(): string {
  return normalizePrefix(
    process.env.ROYAL_R2_CONTENT_PREFIX?.trim() || DEFAULT_LEGACY_PREFIX,
  );
}

function logContentSource(
  source: 'r2' | 'supabase_fallback',
  action: ExamGatewayAction,
  prefix?: string,
): void {
  if (source === 'r2' && process.env.ROYAL_R2_DIAGNOSTICS !== 'true') return;

  const release = prefix ? ` prefix=${prefix}` : '';
  const line = `[royal-exam-content] source=${source} action=${action}${release}\n`;
  if (source === 'r2') {
    process.stdout.write(line);
  } else {
    process.stderr.write(line);
  }
}

export function isExamR2ContentEnabled(): boolean {
  return process.env.ROYAL_R2_CONTENT_ENABLED === 'true' && isPrivateR2Configured();
}

export function r2RpcNameForAction(action: ExamGatewayAction): string | null {
  return R2_RPC_BY_ACTION[action] || null;
}

function asObject(value: unknown): JsonObject | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function resolveContentPrefix(): Promise<string> {
  const root = contentRoot();
  try {
    const rawPointer = await readPrivateR2Json<unknown>(`${root}/active.json`, {
      maxBytes: 16 * 1024,
    });
    const pointer = asObject(rawPointer);
    const releaseId = typeof pointer?.release_id === 'string' ? pointer.release_id : '';
    const prefix = typeof pointer?.prefix === 'string' ? normalizePrefix(pointer.prefix) : '';
    const expectedPrefix = releaseId ? `${root}/releases/${releaseId}` : '';

    if (
      pointer?.schema_version === 1 &&
      /^[0-9a-f]{64}$/.test(releaseId) &&
      prefix === expectedPrefix
    ) {
      return prefix;
    }
  } catch {
    // During rollout or a transient pointer read failure, keep the proven legacy
    // generation available. The active pointer is an optimization/cutover layer,
    // never a reason to make exam content unavailable.
  }

  return legacyContentPrefix();
}

function validateQuestion(value: unknown, expectedId: number): R2Question | null {
  const record = asObject(value);
  if (!record || positiveInteger(record.id) !== expectedId) return null;
  if (typeof record.text_html !== 'string' || typeof record.category !== 'string') return null;
  if (record.topic !== null && typeof record.topic !== 'string') return null;
  if (typeof record.difficulty !== 'string') return null;
  if (record.notes_id !== null && typeof record.notes_id !== 'string') return null;
  if (record.concept_id !== null && typeof record.concept_id !== 'string') return null;
  if (!Array.isArray(record.options)) return null;

  for (const rawOption of record.options) {
    const option = asObject(rawOption);
    if (!option) return null;
    if (!positiveInteger(option.id)) return null;
    if (positiveInteger(option.question_id) !== expectedId) return null;
    if (typeof option.text_html !== 'string') return null;
    if (!Number.isSafeInteger(Number(option.option_order))) return null;
  }

  return record as unknown as R2Question;
}

function validateFeedback(value: unknown, expectedId: number): R2Feedback | null {
  const record = asObject(value);
  if (!record || positiveInteger(record.question_id) !== expectedId) return null;
  if (typeof record.explanation_html !== 'string') return null;
  return record as unknown as R2Feedback;
}

async function readQuestion(prefix: string, questionId: number): Promise<R2Question | null> {
  const raw = await readPrivateR2Json<unknown>(
    `${prefix}/questions/${questionId}.json`,
  );
  return validateQuestion(raw, questionId);
}

async function readFeedback(prefix: string, questionId: number): Promise<R2Feedback | null> {
  const raw = await readPrivateR2Json<unknown>(
    `${prefix}/feedback/${questionId}.json`,
  );
  return validateFeedback(raw, questionId);
}

async function hydrateQuestionRefs(
  prefix: string,
  rawRefs: unknown,
): Promise<R2Question[] | null> {
  if (!Array.isArray(rawRefs)) return null;

  const ids: number[] = [];
  for (const rawRef of rawRefs) {
    const ref = asObject(rawRef);
    const id = positiveInteger(ref?.id);
    if (!id) return null;
    ids.push(id);
  }

  const questions = await Promise.all(ids.map((id) => readQuestion(prefix, id)));
  if (questions.some((question) => question == null)) return null;
  return questions as R2Question[];
}

export async function hydrateExamR2QuestionIds(
  action: 'window' | 'reviewWindow',
  questionIds: number[],
): Promise<string | null> {
  try {
    const prefix = await resolveContentPrefix();
    const questions = await Promise.all(questionIds.map((id) => readQuestion(prefix, id)));
    if (questions.some((question) => question == null)) return null;
    logContentSource('r2', action, prefix);
    return JSON.stringify(questions as R2Question[]);
  } catch {
    return null;
  }
}

async function hydrateFeedbackRecord(
  prefix: string,
  rawFeedback: unknown,
): Promise<JsonObject | null> {
  const feedback = asObject(rawFeedback);
  const questionId = positiveInteger(feedback?.question_id);
  if (!feedback || !questionId) return null;

  const r2Feedback = await readFeedback(prefix, questionId);
  if (!r2Feedback) return null;

  return {
    ...feedback,
    explanation_html: r2Feedback.explanation_html,
  };
}

export async function hydrateExamR2Response(
  action: ExamGatewayAction,
  rawBody: string,
): Promise<string | null> {
  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody) as unknown;
    } catch {
      logContentSource('supabase_fallback', action);
      return null;
    }

    // Resolve exactly once per response so one request can never combine objects
    // from two content generations during an activation switch.
    const prefix = await resolveContentPrefix();
    let hydrated: string | null = null;

    if (action === 'window' || action === 'reviewWindow') {
      const questions = await hydrateQuestionRefs(prefix, parsed);
      hydrated = questions ? JSON.stringify(questions) : null;
    } else if (action === 'bootstrap' || action === 'reviewBootstrap') {
      const bootstrap = asObject(parsed);
      if (bootstrap) {
        const questions = await hydrateQuestionRefs(prefix, bootstrap.questions);
        if (questions) hydrated = JSON.stringify({ ...bootstrap, questions });
      }
    } else if (action === 'feedback' || action === 'trainingFeedback') {
      const feedback = await hydrateFeedbackRecord(prefix, parsed);
      hydrated = feedback ? JSON.stringify(feedback) : null;
    } else if (action === 'submit') {
      const result = asObject(parsed);
      if (result && asObject(result.answer)) {
        const feedback = await hydrateFeedbackRecord(prefix, result.feedback);
        if (feedback) hydrated = JSON.stringify({ ...result, feedback });
      }
    }

    logContentSource(hydrated ? 'r2' : 'supabase_fallback', action, prefix);
    return hydrated;
  } catch {
    logContentSource('supabase_fallback', action);
    return null;
  }
}

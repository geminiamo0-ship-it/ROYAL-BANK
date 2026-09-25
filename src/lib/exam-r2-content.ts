import 'server-only';

import { isPrivateR2Configured, readPrivateR2Json } from '@/lib/r2-private';
import type { ExamGatewayAction } from '@/types/exam-gateway';

const DEFAULT_ROOT = 'exam-content';
const RELEASE_ID_PATTERN = /^[0-9a-f]{64}$/;

const R2_RPC_BY_ACTION: Partial<Record<ExamGatewayAction, string>> = {
  create: 'create_exam_session_bootstrap_idempotent_v3',
  bootstrap: 'get_exam_session_bootstrap_ref_v3',
  window: 'get_exam_session_window_refs_v2',
  reviewBootstrap: 'get_completed_exam_review_bootstrap_ref_v2',
  reviewWindow: 'get_completed_exam_review_window_refs_v2',
  reviewFeedback: 'get_completed_exam_review_feedback_ref_v2',
  feedback: 'get_exam_question_feedback_ref_v2',
  trainingFeedback: 'get_exam_training_feedback_ref_v2',
  submit: 'submit_exam_answer_with_feedback_ref_idempotent_v2',
};

type JsonObject = Record<string, unknown>;

export type ExamContentRelease = {
  releaseId: string;
  prefix: string;
};

export type RevisionRevisionR2Question = {
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

export type RevisionRevisionR2Feedback = {
  question_id: number;
  correct_option_id: number;
  option_percentages: Record<string, number>;
  explanation_html: string;
};

function normalizePrefix(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

function contentRoot(): string {
  return normalizePrefix(process.env.ROYAL_R2_CONTENT_ROOT?.trim() || DEFAULT_ROOT);
}

function prefixForRelease(releaseId: string): string | null {
  if (!RELEASE_ID_PATTERN.test(releaseId)) return null;
  return `${contentRoot()}/releases/${releaseId}`;
}

function logContentSource(
  source: 'r2' | 'r2_unavailable',
  action: ExamGatewayAction,
  prefix?: string,
): void {
  if (source === 'r2' && process.env.ROYAL_R2_DIAGNOSTICS !== 'true') return;
  const release = prefix ? ` prefix=${prefix}` : '';
  const line = `[royal-exam-content] source=${source} action=${action}${release}\n`;
  if (source === 'r2') process.stdout.write(line);
  else process.stderr.write(line);
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

function releaseIdFrom(value: unknown): string | null {
  return typeof value === 'string' && RELEASE_ID_PATTERN.test(value) ? value : null;
}

export async function resolveActiveExamContentRelease(): Promise<ExamContentRelease | null> {
  if (!isExamR2ContentEnabled()) return null;
  const root = contentRoot();
  try {
    const rawPointer = await readPrivateR2Json<unknown>(`${root}/active.json`, {
      maxBytes: 16 * 1024,
    });
    const pointer = asObject(rawPointer);
    const releaseId = releaseIdFrom(pointer?.release_id);
    const prefix = typeof pointer?.prefix === 'string' ? normalizePrefix(pointer.prefix) : '';
    const expectedPrefix = releaseId ? `${root}/releases/${releaseId}` : '';
    const schemaVersion = Number(pointer?.schema_version);

    if (
      (schemaVersion === 1 || schemaVersion === 2) &&
      releaseId &&
      prefix === expectedPrefix
    ) {
      return { releaseId, prefix };
    }
  } catch {
    // Pinned sessions must never silently switch to another generation. Callers
    // surface content unavailability rather than falling back to mutable content.
  }
  return null;
}

function validateQuestion(value: unknown, expectedId: number): RevisionR2Question | null {
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
    // Correctness is intentionally absent from question objects.
    if ('is_correct' in option || 'percentage' in option) return null;
  }

  return record as unknown as RevisionR2Question;
}

function validateFeedback(value: unknown, expectedId: number): RevisionR2Feedback | null {
  const record = asObject(value);
  if (!record || positiveInteger(record.question_id) !== expectedId) return null;
  const correctOptionId = positiveInteger(record.correct_option_id);
  const percentages = asObject(record.option_percentages);
  if (!correctOptionId || !percentages || typeof record.explanation_html !== 'string') return null;
  for (const [optionId, percentage] of Object.entries(percentages)) {
    if (!positiveInteger(optionId) || !Number.isFinite(Number(percentage))) return null;
  }
  return {
    question_id: expectedId,
    correct_option_id: correctOptionId,
    option_percentages: Object.fromEntries(
      Object.entries(percentages).map(([key, value]) => [key, Number(value)]),
    ),
    explanation_html: record.explanation_html,
  };
}

async function readQuestion(prefix: string, questionId: number): Promise<RevisionR2Question | null> {
  const raw = await readPrivateR2Json<unknown>(`${prefix}/questions/${questionId}.json`);
  return validateQuestion(raw, questionId);
}

async function readFeedback(prefix: string, questionId: number): Promise<RevisionR2Feedback | null> {
  const raw = await readPrivateR2Json<unknown>(`${prefix}/feedback/${questionId}.json`);
  return validateFeedback(raw, questionId);
}

async function hydrateQuestionRefs(
  prefix: string,
  rawRefs: unknown,
): Promise<RevisionR2Question[] | null> {
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
  return questions as RevisionR2Question[];
}

export async function hydrateExamRevisionR2QuestionIds(
  action: 'window' | 'reviewWindow',
  questionIds: number[],
  contentReleaseId: string | null,
): Promise<string | null> {
  const prefix = contentReleaseId ? prefixForRelease(contentReleaseId) : null;
  if (!prefix) return null;
  try {
    const questions = await Promise.all(questionIds.map((id) => readQuestion(prefix, id)));
    if (questions.some((question) => question == null)) return null;
    logContentSource('r2', action, prefix);
    return JSON.stringify(questions as RevisionR2Question[]);
  } catch {
    logContentSource('r2_unavailable', action, prefix);
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
    correct_option_id: r2Feedback.correct_option_id,
    option_percentages: r2Feedback.option_percentages,
    explanation_html: r2Feedback.explanation_html,
  };
}

function pinnedReleaseForResponse(action: ExamGatewayAction, parsed: unknown): string | null {
  const payload = asObject(parsed);
  if (!payload) return null;

  if (action === 'create' || action === 'bootstrap' || action === 'reviewBootstrap') {
    return releaseIdFrom(asObject(payload.session)?.content_release_id);
  }
  if (action === 'window' || action === 'reviewWindow') {
    return releaseIdFrom(payload.content_release_id);
  }
  if (action === 'feedback' || action === 'trainingFeedback' || action === 'reviewFeedback') {
    return releaseIdFrom(payload.content_release_id);
  }
  if (action === 'submit') {
    return releaseIdFrom(asObject(payload.feedback)?.content_release_id);
  }
  return null;
}

export async function hydrateExamR2Response(
  action: ExamGatewayAction,
  rawBody: string,
): Promise<string | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody) as unknown;
  } catch {
    logContentSource('r2_unavailable', action);
    return null;
  }

  const releaseId = pinnedReleaseForResponse(action, parsed);
  const prefix = releaseId ? prefixForRelease(releaseId) : null;
  if (!prefix) {
    logContentSource('r2_unavailable', action);
    return null;
  }

  try {
    let hydrated: string | null = null;

    if (action === 'window' || action === 'reviewWindow') {
      const wrapper = asObject(parsed);
      const questions = await hydrateQuestionRefs(prefix, wrapper?.questions);
      hydrated = questions ? JSON.stringify(questions) : null;
    } else if (action === 'create' || action === 'bootstrap' || action === 'reviewBootstrap') {
      const bootstrap = asObject(parsed);
      if (bootstrap) {
        const questions = await hydrateQuestionRefs(prefix, bootstrap.questions);
        if (questions) hydrated = JSON.stringify({ ...bootstrap, questions });
      }
    } else if (
      action === 'feedback' ||
      action === 'trainingFeedback' ||
      action === 'reviewFeedback'
    ) {
      const feedback = await hydrateFeedbackRecord(prefix, parsed);
      hydrated = feedback ? JSON.stringify(feedback) : null;
    } else if (action === 'submit') {
      const result = asObject(parsed);
      if (result && asObject(result.answer)) {
        const feedback = await hydrateFeedbackRecord(prefix, result.feedback);
        if (feedback) hydrated = JSON.stringify({ ...result, feedback });
      }
    }

    logContentSource(hydrated ? 'r2' : 'r2_unavailable', action, prefix);
    return hydrated;
  } catch {
    logContentSource('r2_unavailable', action, prefix);
    return null;
  }
}


export async function readRevisionQuestionContent(
  contentReleaseId: string | null,
  questionId: number,
): Promise<RevisionR2Question | null> {
  if (!isExamR2ContentEnabled() || !Number.isSafeInteger(questionId) || questionId <= 0) return null;
  const release = contentReleaseId
    ? { releaseId: contentReleaseId, prefix: prefixForRelease(contentReleaseId) }
    : await resolveActiveExamContentRelease();
  const prefix = release?.prefix ?? null;
  if (!prefix) return null;
  try {
    return await readQuestion(prefix, questionId);
  } catch {
    return null;
  }
}

export async function readRevisionQuestionFeedback(
  contentReleaseId: string | null,
  questionId: number,
): Promise<RevisionR2Feedback | null> {
  if (!isExamR2ContentEnabled() || !Number.isSafeInteger(questionId) || questionId <= 0) return null;
  const release = contentReleaseId
    ? { releaseId: contentReleaseId, prefix: prefixForRelease(contentReleaseId) }
    : await resolveActiveExamContentRelease();
  const prefix = release?.prefix ?? null;
  if (!prefix) return null;
  try {
    return await readFeedback(prefix, questionId);
  } catch {
    return null;
  }
}

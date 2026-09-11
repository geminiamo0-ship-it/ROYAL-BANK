import 'server-only';

import { isPrivateR2Configured, readPrivateR2Json } from '@/lib/r2-private';
import type { ExamGatewayAction } from '@/types/exam-gateway';

const DEFAULT_PREFIX = 'exam-content/v1';

const R2_RPC_BY_ACTION: Partial<Record<ExamGatewayAction, string>> = {
  bootstrap: 'get_exam_session_bootstrap_ref',
  window: 'get_exam_session_window_refs',
  reviewBootstrap: 'get_completed_exam_review_bootstrap_ref',
  reviewWindow: 'get_completed_exam_review_window_refs',
  feedback: 'get_exam_question_feedback_ref',
  submit: 'submit_exam_answer_with_feedback_ref',
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

function contentPrefix(): string {
  return (process.env.ROYAL_R2_CONTENT_PREFIX?.trim() || DEFAULT_PREFIX).replace(/^\/+|\/+$/g, '');
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

async function readQuestion(questionId: number): Promise<R2Question | null> {
  const raw = await readPrivateR2Json<unknown>(
    `${contentPrefix()}/questions/${questionId}.json`,
  );
  return validateQuestion(raw, questionId);
}

async function readFeedback(questionId: number): Promise<R2Feedback | null> {
  const raw = await readPrivateR2Json<unknown>(
    `${contentPrefix()}/feedback/${questionId}.json`,
  );
  return validateFeedback(raw, questionId);
}

async function hydrateQuestionRefs(rawRefs: unknown): Promise<R2Question[] | null> {
  if (!Array.isArray(rawRefs)) return null;

  const ids: number[] = [];
  for (const rawRef of rawRefs) {
    const ref = asObject(rawRef);
    const id = positiveInteger(ref?.id);
    if (!id) return null;
    ids.push(id);
  }

  const questions = await Promise.all(ids.map((id) => readQuestion(id)));
  if (questions.some((question) => question == null)) return null;
  return questions as R2Question[];
}

async function hydrateFeedbackRecord(rawFeedback: unknown): Promise<JsonObject | null> {
  const feedback = asObject(rawFeedback);
  const questionId = positiveInteger(feedback?.question_id);
  if (!feedback || !questionId) return null;

  const r2Feedback = await readFeedback(questionId);
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }

  if (action === 'window' || action === 'reviewWindow') {
    const questions = await hydrateQuestionRefs(parsed);
    return questions ? JSON.stringify(questions) : null;
  }

  if (action === 'bootstrap' || action === 'reviewBootstrap') {
    const bootstrap = asObject(parsed);
    if (!bootstrap) return null;
    const questions = await hydrateQuestionRefs(bootstrap.questions);
    if (!questions) return null;
    return JSON.stringify({ ...bootstrap, questions });
  }

  if (action === 'feedback') {
    const feedback = await hydrateFeedbackRecord(parsed);
    return feedback ? JSON.stringify(feedback) : null;
  }

  if (action === 'submit') {
    const result = asObject(parsed);
    if (!result || !asObject(result.answer)) return null;
    const feedback = await hydrateFeedbackRecord(result.feedback);
    if (!feedback) return null;
    return JSON.stringify({ ...result, feedback });
  }

  return null;
}

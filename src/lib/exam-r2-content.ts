import 'server-only';

import { isPrivateR2Configured, readPrivateR2Json } from '@/lib/r2-private';
import type { ExamGatewayAction } from '@/types/exam-gateway';

const DEFAULT_PREFIX = 'exam-content/v1';

const R2_RPC_BY_ACTION: Partial<Record<ExamGatewayAction, string>> = {
  create: 'create_exam_session_bootstrap_idempotent',
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

function logContentSource(
  source: 'r2' | 'supabase_fallback',
  action: ExamGatewayAction,
): void {
  if (source === 'r2' && process.env.ROYAL_R2_DIAGNOSTICS !== 'true') return;

  const line = `[royal-exam-content] source=${source} action=${action}\n`;
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

function sanitizePrefetchedFeedback(value: unknown, expectedId: number): JsonObject | null {
  const record = asObject(value);
  if (!record || positiveInteger(record.question_id) !== expectedId) return null;

  const correctOptionId = positiveInteger(record.correct_option_id);
  if (!correctOptionId || typeof record.explanation_html !== 'string') return null;

  const rawPercentages = asObject(record.option_percentages) || {};
  const optionPercentages: Record<string, number> = {};
  for (const [optionId, percentage] of Object.entries(rawPercentages)) {
    const parsedId = positiveInteger(optionId);
    const parsedPercentage = Number(percentage);
    if (!parsedId || !Number.isFinite(parsedPercentage)) continue;
    optionPercentages[String(parsedId)] = parsedPercentage;
  }

  return {
    question_id: expectedId,
    correct_option_id: correctOptionId,
    explanation_html: record.explanation_html,
    option_percentages: optionPercentages,
  };
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

async function hydrateQuestionRefs(rawRefs: unknown): Promise<Array<R2Question & JsonObject> | null> {
  if (!Array.isArray(rawRefs)) return null;

  const refs: Array<{ id: number; prefetchedFeedback: JsonObject | null }> = [];
  for (const rawRef of rawRefs) {
    const ref = asObject(rawRef);
    const id = positiveInteger(ref?.id);
    if (!id) return null;
    refs.push({
      id,
      prefetchedFeedback: sanitizePrefetchedFeedback(ref?.prefetched_feedback, id),
    });
  }

  const questions = await Promise.all(refs.map(({ id }) => readQuestion(id)));
  if (questions.some((question) => question == null)) return null;

  return questions.map((question, index) => {
    const hydrated = question as R2Question;
    const prefetchedFeedback = refs[index]?.prefetchedFeedback;
    return prefetchedFeedback
      ? { ...hydrated, prefetched_feedback: prefetchedFeedback }
      : hydrated;
  });
}

export async function hydrateExamR2QuestionIds(
  action: 'window' | 'reviewWindow',
  questionIds: number[],
): Promise<string | null> {
  try {
    const questions = await Promise.all(questionIds.map((id) => readQuestion(id)));
    if (questions.some((question) => question == null)) return null;
    logContentSource('r2', action);
    return JSON.stringify(questions as R2Question[]);
  } catch {
    return null;
  }
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
  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody) as unknown;
    } catch {
      logContentSource('supabase_fallback', action);
      return null;
    }

    let hydrated: string | null = null;

    if (action === 'window' || action === 'reviewWindow') {
      const questions = await hydrateQuestionRefs(parsed);
      hydrated = questions ? JSON.stringify(questions) : null;
    } else if (action === 'create' || action === 'bootstrap' || action === 'reviewBootstrap') {
      const bootstrap = asObject(parsed);
      if (bootstrap) {
        const questions = await hydrateQuestionRefs(bootstrap.questions);
        if (questions) hydrated = JSON.stringify({ ...bootstrap, questions });
      }
    } else if (action === 'feedback') {
      const feedback = await hydrateFeedbackRecord(parsed);
      hydrated = feedback ? JSON.stringify(feedback) : null;
    } else if (action === 'submit') {
      const result = asObject(parsed);
      if (result && asObject(result.answer)) {
        const feedback = await hydrateFeedbackRecord(result.feedback);
        if (feedback) hydrated = JSON.stringify({ ...result, feedback });
      }
    }

    logContentSource(hydrated ? 'r2' : 'supabase_fallback', action);
    return hydrated;
  } catch {
    logContentSource('supabase_fallback', action);
    return null;
  }
}

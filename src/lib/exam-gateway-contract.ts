import { z } from 'zod';
import type { ExamGatewayAction } from '@/types/exam-gateway';

export const EXAM_RPC_BY_ACTION: Record<ExamGatewayAction, string> = {
  prepare: 'can_access_question_bank',
  create: 'create_exam_session_bootstrap_idempotent_v3',
  bootstrap: 'get_exam_session_bootstrap_v3',
  window: 'get_exam_session_window',
  reviewBootstrap: 'get_completed_exam_review_bootstrap',
  reviewWindow: 'get_completed_exam_review_window',
  reviewFeedback: 'get_completed_exam_review_feedback',
  trainingFeedback: 'get_exam_training_feedback',
  renewWindowAccess: 'renew_exam_window_access',
  submit: 'submit_exam_answer_with_feedback_idempotent',
  submitRaw: 'submit_exam_answer_idempotent',
  feedback: 'get_exam_question_feedback',
  flag: 'set_question_flag',
  annotationsGet: 'edge_annotations_get',
  annotationsBatch: 'edge_annotations_batch',
  annotationsClear: 'edge_annotations_clear',
  complete: 'complete_exam_session',
};

const positiveId = z.number().int().positive().safe();
const nonNegativeInteger = z.number().int().nonnegative().safe();
const uuid = z.string().uuid();
const boundedText = z.string().trim().min(1).max(300);

const sessionType = z.enum([
  'standard',
  'tutor',
  'timed',
  'fixed_timed',
  'mock_exam',
  'review',
  'quick_champion',
]);

const questionSelection = z.enum([
  'new_only',
  'incorrect_only',
  'all',
  'flagged_only',
  'suspended_only',
]);

const prepareArgsSchema = z
  .object({
    p_bank_id: positiveId,
  })
  .strict();

const createArgsSchema = z
  .object({
    p_request_id: uuid,
    p_bank_id: positiveId,
    p_session_type: sessionType,
    p_limit: z.number().int().min(1).max(70),
    p_difficulties: z.array(z.enum(['1', '2', '3'])).max(3),
    p_categories: z.array(boundedText).max(100),
    p_topics: z
      .array(
        z
          .object({
            category: boundedText,
            topic: boundedText,
          })
          .strict(),
      )
      .max(100),
    p_question_selection: questionSelection,
  })
  .strict();

const sessionArgsSchema = z
  .object({
    p_session_id: uuid,
  })
  .strict();

const windowArgsSchema = z
  .object({
    p_session_id: uuid,
    p_start: nonNegativeInteger,
    p_count: z.number().int().min(1).max(5),
  })
  .strict();

const answerArgsSchema = z
  .object({
    p_request_id: uuid,
    p_session_id: uuid,
    p_question_id: positiveId,
    p_selected_option_id: positiveId,
    p_time_spent_seconds: nonNegativeInteger,
  })
  .strict();

const feedbackArgsSchema = z
  .object({
    p_session_id: uuid,
    p_question_id: positiveId,
  })
  .strict();

const flagArgsSchema = z
  .object({
    p_question_id: positiveId,
    p_flagged: z.boolean(),
  })
  .strict();

const annotationColor = z.enum(['yellow', 'red', 'blue', 'green', 'purple']);
const annotationPoint = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
]);

const annotationStroke = z.discriminatedUnion('tool', [
  z.object({
    id: z.string().min(1).max(80),
    tool: z.literal('text-highlight'),
    start: z.number().int().nonnegative().max(250000),
    end: z.number().int().positive().max(250000),
    color: annotationColor.optional(),
    quote: z.string().max(1000).optional(),
  }).strict().refine((value) => value.end > value.start, {
    message: 'Highlight end must be after start.',
  }),
  z.object({
    id: z.string().min(1).max(80),
    tool: z.enum(['pencil', 'highlighter']),
    width: z.number().min(0.5).max(48),
    points: z.array(annotationPoint).min(2).max(2000),
    color: annotationColor.optional(),
  }).strict(),
]);

const annotationUpdate = z.object({
  surface: z.enum(['stem', 'options', 'explanation']),
  content_hash: z.string().regex(/^[0-9a-f]{64}$/),
  strokes: z.array(annotationStroke).max(500).refine((value) => {
    try {
      return new TextEncoder().encode(JSON.stringify(value)).byteLength <= 262144;
    } catch {
      return false;
    }
  }, { message: 'Annotation payload is too large.' }),
}).strict();

const annotationQuestionArgsSchema = z.object({
  p_session_id: uuid,
  p_question_id: positiveId,
}).strict();

const annotationBatchArgsSchema = z.object({
  p_session_id: uuid,
  p_question_id: positiveId,
  p_updates: z.array(annotationUpdate).max(3),
  p_seed: z.boolean().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.p_updates.length === 0 && value.p_seed !== true) {
    ctx.addIssue({
      code: 'custom',
      message: 'Annotation updates are required unless seeding.',
      path: ['p_updates'],
    });
  }
});

const ARGS_SCHEMA_BY_ACTION = {
  prepare: prepareArgsSchema,
  create: createArgsSchema,
  bootstrap: sessionArgsSchema,
  window: windowArgsSchema,
  reviewBootstrap: sessionArgsSchema,
  reviewWindow: windowArgsSchema,
  reviewFeedback: feedbackArgsSchema,
  trainingFeedback: feedbackArgsSchema,
  renewWindowAccess: sessionArgsSchema,
  submit: answerArgsSchema,
  submitRaw: answerArgsSchema,
  feedback: feedbackArgsSchema,
  flag: flagArgsSchema,
  annotationsGet: annotationQuestionArgsSchema,
  annotationsBatch: annotationBatchArgsSchema,
  annotationsClear: annotationQuestionArgsSchema,
  complete: sessionArgsSchema,
} satisfies Record<ExamGatewayAction, z.ZodType>;

type ParsedExamGatewayRequest = {
  action: ExamGatewayAction;
  args: Record<string, unknown>;
};

export type ExamGatewayRequestParseResult =
  | { ok: true; value: ParsedExamGatewayRequest }
  | { ok: false; code: 'INVALID_REQUEST' | 'INVALID_EXAM_ACTION' };

export function parseExamGatewayRequest(input: unknown): ExamGatewayRequestParseResult {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }

  const record = input as Record<string, unknown>;
  if (typeof record.action !== 'string') {
    return { ok: false, code: 'INVALID_EXAM_ACTION' };
  }

  if (!Object.prototype.hasOwnProperty.call(ARGS_SCHEMA_BY_ACTION, record.action)) {
    return { ok: false, code: 'INVALID_EXAM_ACTION' };
  }

  const action = record.action as ExamGatewayAction;
  const parsedArgs = ARGS_SCHEMA_BY_ACTION[action].safeParse(record.args);
  if (!parsedArgs.success) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }

  return {
    ok: true,
    value: {
      action,
      args: parsedArgs.data as Record<string, unknown>,
    },
  };
}

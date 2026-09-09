import { z } from 'zod';
import type { ExamGatewayAction } from '@/types/exam-gateway';

export const EXAM_RPC_BY_ACTION: Record<ExamGatewayAction, string> = {
  create: 'create_exam_session_bootstrap_idempotent',
  bootstrap: 'get_exam_session_bootstrap',
  window: 'get_exam_session_window',
  submit: 'submit_exam_answer_with_feedback',
  submitRaw: 'submit_exam_answer',
  feedback: 'get_exam_question_feedback',
  flag: 'set_question_flag',
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

const ARGS_SCHEMA_BY_ACTION = {
  create: createArgsSchema,
  bootstrap: sessionArgsSchema,
  window: windowArgsSchema,
  submit: answerArgsSchema,
  submitRaw: answerArgsSchema,
  feedback: feedbackArgsSchema,
  flag: flagArgsSchema,
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

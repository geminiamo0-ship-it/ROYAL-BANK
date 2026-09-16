export type SessionType =
  | 'standard'
  | 'tutor'
  | 'timed'
  | 'fixed_timed'
  | 'mock_exam'
  | 'review'
  | 'quick_champion';

export type QuestionSelection =
  | 'new_only'
  | 'incorrect_only'
  | 'all'
  | 'flagged_only'
  | 'suspended_only';

export type GatewayAction =
  | 'prepare'
  | 'create'
  | 'bootstrap'
  | 'window'
  | 'reviewBootstrap'
  | 'reviewWindow'
  | 'reviewFeedback'
  | 'trainingFeedback'
  | 'renewWindowAccess'
  | 'submit'
  | 'submitRaw'
  | 'feedback'
  | 'flag'
  | 'suspend'
  | 'resume'
  | 'complete';

export type GatewayRequest = {
  action: GatewayAction;
  args: Record<string, unknown>;
};

export type InternalGatewayRequest = GatewayRequest & {
  userId: string;
  bankAccessGranted?: boolean;
};

const DEFAULT_TIMED_SECONDS_PER_QUESTION = 90;

const actions = new Set<GatewayAction>([
  'prepare',
  'create',
  'bootstrap',
  'window',
  'reviewBootstrap',
  'reviewWindow',
  'reviewFeedback',
  'trainingFeedback',
  'renewWindowAccess',
  'submit',
  'submitRaw',
  'feedback',
  'flag',
  'suspend',
  'resume',
  'complete',
]);

const sessionTypes = new Set<SessionType>([
  'standard',
  'tutor',
  'timed',
  'fixed_timed',
  'mock_exam',
  'review',
  'quick_champion',
]);

const selections = new Set<QuestionSelection>([
  'new_only',
  'incorrect_only',
  'all',
  'flagged_only',
  'suspended_only',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validCreate(args: Record<string, unknown>): boolean {
  if (!isUuid(args.p_request_id) || !isPositiveInteger(args.p_bank_id)) return false;
  if (!sessionTypes.has(args.p_session_type as SessionType)) return false;
  if (!isPositiveInteger(args.p_limit) || Number(args.p_limit) > 70) return false;
  if (!selections.has(args.p_question_selection as QuestionSelection)) return false;
  if (!Array.isArray(args.p_difficulties) || args.p_difficulties.some((v) => !['1', '2', '3'].includes(String(v)))) return false;
  if (!Array.isArray(args.p_categories) || args.p_categories.some((v) => typeof v !== 'string' || !v.trim())) return false;
  if (!Array.isArray(args.p_topics)) return false;
  if (!args.p_topics.every((value) => isRecord(value) && typeof value.category === 'string' && typeof value.topic === 'string' && value.category.trim() && value.topic.trim())) return false;
  if (args.p_time_limit_minutes != null && (!isPositiveInteger(args.p_time_limit_minutes) || Number(args.p_time_limit_minutes) > 24 * 60)) return false;
  return true;
}

function normalizeCreate(args: Record<string, unknown>): Record<string, unknown> {
  const sessionType = args.p_session_type as SessionType;
  if (
    (sessionType === 'timed' || sessionType === 'fixed_timed' || sessionType === 'mock_exam') &&
    args.p_time_limit_minutes == null
  ) {
    return {
      ...args,
      p_time_limit_minutes: Math.max(
        1,
        Math.ceil((Number(args.p_limit) * DEFAULT_TIMED_SECONDS_PER_QUESTION) / 60),
      ),
    };
  }
  return args;
}

export function parseGatewayRequest(value: unknown): GatewayRequest | null {
  if (!isRecord(value) || typeof value.action !== 'string' || !actions.has(value.action as GatewayAction)) return null;
  if (!isRecord(value.args)) return null;
  const action = value.action as GatewayAction;
  const args = value.args;

  if (action === 'prepare') return isPositiveInteger(args.p_bank_id) ? { action, args } : null;
  if (action === 'create') return validCreate(args) ? { action, args: normalizeCreate(args) } : null;
  if (action === 'flag') {
    return isPositiveInteger(args.p_question_id) && typeof args.p_flagged === 'boolean' ? { action, args } : null;
  }
  if (action === 'window' || action === 'reviewWindow') {
    const maxCount = action === 'window' ? 3 : 5;
    return isUuid(args.p_session_id) && isNonNegativeInteger(args.p_start) && isPositiveInteger(args.p_count) && Number(args.p_count) <= maxCount ? { action, args } : null;
  }
  if (action === 'submit' || action === 'submitRaw') {
    return isUuid(args.p_request_id) && isUuid(args.p_session_id) && isPositiveInteger(args.p_question_id) && isPositiveInteger(args.p_selected_option_id) && isNonNegativeInteger(args.p_time_spent_seconds) ? { action, args } : null;
  }
  if (action === 'feedback' || action === 'reviewFeedback' || action === 'trainingFeedback') {
    return isUuid(args.p_session_id) && isPositiveInteger(args.p_question_id) ? { action, args } : null;
  }
  return isUuid(args.p_session_id) ? { action, args } : null;
}

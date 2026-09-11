import type { SessionType } from '@/types/database';

export type ExamModeCapabilities = {
  canChangeAnswerBeforeCompletion: boolean;
  canSeeFeedbackBeforeCompletion: boolean;
  canPrefetchFeedback: boolean;
  canSeeOptionPercentagesBeforeCompletion: boolean;
};

const LOCKED_MODE: ExamModeCapabilities = {
  canChangeAnswerBeforeCompletion: true,
  canSeeFeedbackBeforeCompletion: false,
  canPrefetchFeedback: false,
  canSeeOptionPercentagesBeforeCompletion: false,
};

export const EXAM_MODE_CAPABILITIES: Record<SessionType, ExamModeCapabilities> = {
  standard: {
    canChangeAnswerBeforeCompletion: false,
    canSeeFeedbackBeforeCompletion: true,
    canPrefetchFeedback: true,
    canSeeOptionPercentagesBeforeCompletion: true,
  },
  tutor: {
    canChangeAnswerBeforeCompletion: false,
    canSeeFeedbackBeforeCompletion: true,
    canPrefetchFeedback: true,
    canSeeOptionPercentagesBeforeCompletion: true,
  },
  timed: LOCKED_MODE,
  fixed_timed: LOCKED_MODE,
  mock_exam: LOCKED_MODE,
  review: LOCKED_MODE,
  quick_champion: LOCKED_MODE,
};

export function examModeCapabilities(sessionType: SessionType): ExamModeCapabilities {
  return EXAM_MODE_CAPABILITIES[sessionType] ?? LOCKED_MODE;
}

export function isTrainingSessionType(sessionType: SessionType): boolean {
  return sessionType === 'standard' || sessionType === 'tutor';
}

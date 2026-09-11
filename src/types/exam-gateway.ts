import type { QuestionSelection, SessionType } from '@/types/database';

export type ExamGatewayAction =
  | 'create'
  | 'bootstrap'
  | 'window'
  | 'reviewBootstrap'
  | 'reviewWindow'
  | 'reviewFeedback'
  | 'trainingFeedback'
  | 'submit'
  | 'submitRaw'
  | 'feedback'
  | 'flag'
  | 'complete';

export type ExamGatewayArgsByAction = {
  create: {
    p_request_id: string;
    p_bank_id: number;
    p_session_type: SessionType;
    p_limit: number;
    p_difficulties: string[];
    p_categories: string[];
    p_topics: Array<{ category: string; topic: string }>;
    p_question_selection: QuestionSelection;
  };
  bootstrap: {
    p_session_id: string;
  };
  window: {
    p_session_id: string;
    p_start: number;
    p_count: number;
  };
  reviewBootstrap: {
    p_session_id: string;
  };
  reviewWindow: {
    p_session_id: string;
    p_start: number;
    p_count: number;
  };
  reviewFeedback: {
    p_session_id: string;
    p_question_id: number;
  };
  trainingFeedback: {
    p_session_id: string;
    p_question_id: number;
  };
  submit: {
    p_request_id: string;
    p_session_id: string;
    p_question_id: number;
    p_selected_option_id: number;
    p_time_spent_seconds: number;
  };
  submitRaw: {
    p_request_id: string;
    p_session_id: string;
    p_question_id: number;
    p_selected_option_id: number;
    p_time_spent_seconds: number;
  };
  feedback: {
    p_session_id: string;
    p_question_id: number;
  };
  flag: {
    p_question_id: number;
    p_flagged: boolean;
  };
  complete: {
    p_session_id: string;
  };
};

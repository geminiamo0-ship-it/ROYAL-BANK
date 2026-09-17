import type { UserExamState } from './user-exam-state';

export type ExamSyncEvent = {
  event_id: string;
  user_id: string;
  session_id: string | null;
  stream_version: number;
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: string;
};

export type RoyalEnvironment = 'development' | 'staging' | 'production';

declare global {
  interface Env {
    USER_EXAMS: DurableObjectNamespace<UserExamState>;
    EXAM_CONTENT: R2Bucket;
    EXAM_SYNC_QUEUE: Queue<ExamSyncEvent>;
    SUPABASE_URL: string;
    SUPABASE_PROJECT_REF: string;
    SUPABASE_PUBLISHABLE_KEY: string;
    SUPABASE_SECRET_KEY?: string;
    EXAM_CONTENT_ROOT: string;
    APP_ENV: RoyalEnvironment;
    EXAM_SYNC_QUEUE_NAME: string;
    SERVICE_NAME: string;
  }
}

export {};

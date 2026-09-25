import type { UserExamState } from './user-exam-state';
import type { DeepDiveCache } from './deep-dive-cache';
import type { DeepDiveUserState } from './deep-dive-user-state';
import type { DeepDiveConfigState } from './deep-dive-config-state';

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
    DEEP_DIVE_USERS: DurableObjectNamespace<DeepDiveUserState>;
    DEEP_DIVE_CACHE: DurableObjectNamespace<DeepDiveCache>;
    DEEP_DIVE_CONFIG: DurableObjectNamespace<DeepDiveConfigState>;
    EXAM_CONTENT: R2Bucket;
    EXAM_SYNC_QUEUE: Queue<ExamSyncEvent>;
    SUPABASE_URL: string;
    SUPABASE_PROJECT_REF: string;
    SUPABASE_PUBLISHABLE_KEY: string;
    SUPABASE_SECRET_KEY?: string;
    OPENROUTER_API_KEY?: string;
    EXAM_CONTENT_ROOT: string;
    APP_ENV: RoyalEnvironment;
    EXAM_SYNC_QUEUE_NAME: string;
    SERVICE_NAME: string;
  }
}

export {};

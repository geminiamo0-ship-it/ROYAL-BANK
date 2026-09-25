import type { ExamSyncEvent } from './env';
import { normalizedSupabaseUrl } from './auth';

const MAX_SYNC_BATCH = 100;

function assertSyncEvent(event: ExamSyncEvent): void {
  if (!event || typeof event !== 'object') throw new Error('Invalid sync event.');
  if (typeof event.event_id !== 'string' || !event.event_id) throw new Error('Sync event id is missing.');
  if (typeof event.user_id !== 'string' || !event.user_id) throw new Error('Sync user id is missing.');
  if (event.session_id !== null && typeof event.session_id !== 'string') throw new Error('Invalid sync session id.');
  if (!Number.isInteger(event.stream_version) || event.stream_version < 0) throw new Error('Invalid stream version.');
  if (typeof event.event_type !== 'string' || !event.event_type) throw new Error('Sync event type is missing.');
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) throw new Error('Invalid sync payload.');
  if (typeof event.occurred_at !== 'string' || !Number.isFinite(Date.parse(event.occurred_at))) {
    throw new Error('Invalid sync timestamp.');
  }
}

function numberOrZero(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

async function syncAiUsageEvents(env: Env, secretKey: string, events: ExamSyncEvent[]): Promise<number> {
  if (events.length === 0) return 0;

  const rows = events.map((event) => ({
    event_id: event.event_id,
    user_id: event.user_id,
    session_id: event.session_id,
    thread_id: typeof event.payload.thread_id === 'string' ? event.payload.thread_id : null,
    question_id: Number.isSafeInteger(Number(event.payload.question_id))
      ? Number(event.payload.question_id)
      : null,
    event_type: event.event_type,
    model: typeof event.payload.model === 'string' ? event.payload.model : null,
    prompt_version: typeof event.payload.prompt_version === 'string' ? event.payload.prompt_version : null,
    cache_hit: event.payload.cache_hit === true,
    input_tokens: numberOrZero(event.payload.input_tokens),
    output_tokens: numberOrZero(event.payload.output_tokens),
    latency_ms: numberOrZero(event.payload.latency_ms),
    occurred_at: event.occurred_at,
  }));

  const response = await fetch(`${normalizedSupabaseUrl(env)}/rest/v1/ai_usage_events?on_conflict=event_id`, {
    method: 'POST',
    headers: {
      apikey: secretKey,
      authorization: `Bearer ${secretKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
      prefer: 'resolution=ignore-duplicates,return=minimal',
      'user-agent': 'royal-bank-ai-sync/1.0',
    },
    body: JSON.stringify(rows),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`AI usage sync failed (${response.status}): ${detail}`);
  }
  return rows.length;
}

async function syncExamHistoryEvents(env: Env, secretKey: string, events: ExamSyncEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  const response = await fetch(`${normalizedSupabaseUrl(env)}/rest/v1/rpc/ingest_edge_exam_sync_batch`, {
    method: 'POST',
    headers: {
      apikey: secretKey,
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': 'royal-bank-exam-sync/1.0',
    },
    body: JSON.stringify({ p_events: events }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Supabase sync failed (${response.status}): ${detail}`);
  }

  const value = await response.json<unknown>();
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('Supabase sync returned an invalid result.');
  }
  return value;
}

export async function syncExamEventsToSupabase(env: Env, events: ExamSyncEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  if (events.length > MAX_SYNC_BATCH) throw new Error(`Sync batch exceeds ${MAX_SYNC_BATCH} events.`);
  for (const event of events) assertSyncEvent(event);

  const secretKey = env.SUPABASE_SECRET_KEY?.trim();
  if (!secretKey) throw new Error('SUPABASE_SECRET_KEY is not configured.');

  const aiEvents = events.filter((event) => event.event_type.startsWith('ai.'));
  const examEvents = events.filter((event) => !event.event_type.startsWith('ai.'));

  // Exam history is correctness-critical and retains the queue retry semantics.
  // AI telemetry is observability-only: never let an analytics write failure
  // delay or replay exam history events.
  const examCount = await syncExamHistoryEvents(env, secretKey, examEvents);
  let aiCount = 0;
  try {
    aiCount = await syncAiUsageEvents(env, secretKey, aiEvents);
  } catch (error) {
    console.error('AI_USAGE_TELEMETRY_DROPPED', error);
  }
  return examCount + aiCount;
}

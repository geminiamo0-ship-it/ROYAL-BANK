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

export async function syncExamEventsToSupabase(env: Env, events: ExamSyncEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  if (events.length > MAX_SYNC_BATCH) throw new Error(`Sync batch exceeds ${MAX_SYNC_BATCH} events.`);
  for (const event of events) assertSyncEvent(event);

  const secretKey = env.SUPABASE_SECRET_KEY?.trim();
  if (!secretKey) throw new Error('SUPABASE_SECRET_KEY is not configured.');

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

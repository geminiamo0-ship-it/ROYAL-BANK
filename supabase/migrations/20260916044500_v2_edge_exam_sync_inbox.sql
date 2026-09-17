-- V2 Cloudflare exam-event inbox.
-- DEV-first migration: Queue deliveries are idempotent by event_id and are not
-- exposed to anon/authenticated callers.

create table if not exists public.edge_exam_sync_inbox (
  event_id text primary key,
  user_id text not null,
  session_id text,
  stream_version bigint not null check (stream_version >= 0),
  event_type text not null,
  payload jsonb not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  process_attempts integer not null default 0 check (process_attempts >= 0),
  last_error text
);

alter table public.edge_exam_sync_inbox enable row level security;

create index if not exists idx_edge_exam_sync_inbox_session_version
  on public.edge_exam_sync_inbox(user_id, session_id, stream_version);

create index if not exists idx_edge_exam_sync_inbox_unprocessed
  on public.edge_exam_sync_inbox(received_at, event_id)
  where processed_at is null;

revoke all on table public.edge_exam_sync_inbox from public;
revoke all on table public.edge_exam_sync_inbox from anon;
revoke all on table public.edge_exam_sync_inbox from authenticated;
grant select, insert, update on table public.edge_exam_sync_inbox to service_role;

create or replace function public.ingest_edge_exam_sync_batch(p_events jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  inserted_count integer := 0;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'p_events must be a json array';
  end if;

  if jsonb_array_length(p_events) > 100 then
    raise exception 'p_events may contain at most 100 events';
  end if;

  insert into public.edge_exam_sync_inbox (
    event_id,
    user_id,
    session_id,
    stream_version,
    event_type,
    payload,
    occurred_at,
    received_at,
    process_attempts
  )
  select
    e->>'event_id',
    e->>'user_id',
    nullif(e->>'session_id', ''),
    (e->>'stream_version')::bigint,
    e->>'event_type',
    coalesce(e->'payload', '{}'::jsonb),
    (e->>'occurred_at')::timestamptz,
    now(),
    0
  from jsonb_array_elements(p_events) as e
  where nullif(e->>'event_id', '') is not null
    and nullif(e->>'user_id', '') is not null
    and nullif(e->>'event_type', '') is not null
    and nullif(e->>'occurred_at', '') is not null
  on conflict (event_id) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.ingest_edge_exam_sync_batch(jsonb) from public;
revoke all on function public.ingest_edge_exam_sync_batch(jsonb) from anon;
revoke all on function public.ingest_edge_exam_sync_batch(jsonb) from authenticated;
grant execute on function public.ingest_edge_exam_sync_batch(jsonb) to service_role;

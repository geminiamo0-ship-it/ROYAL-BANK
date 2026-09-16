create index if not exists idx_edge_exam_sync_inbox_user_processed_received
  on public.edge_exam_sync_inbox(user_id, received_at)
  where processed_at is not null;

create or replace function public.compact_edge_sync_inbox_after_materialize()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_processed_at timestamptz;
begin
  select inbox.processed_at
  into v_processed_at
  from public.edge_exam_sync_inbox inbox
  where inbox.event_id = new.event_id;

  if v_processed_at is null then
    return null;
  end if;

  -- Keep the idempotency key and routing metadata, but release the potentially
  -- multi-KB completion snapshot once its bounded projections have materialized.
  update public.edge_exam_sync_inbox
  set payload = '{}'::jsonb
  where event_id = new.event_id
    and payload <> '{}'::jsonb;

  -- Cloudflare Queues can retain a message for at most 14 days. Keep successful
  -- event ids for 15 days after database receipt so a Queue redelivery remains
  -- de-duplicated, then prune only this user's old processed ledger entries.
  if new.event_type = 'session.completed' then
    delete from public.edge_exam_sync_inbox old_event
    where old_event.user_id = new.user_id
      and old_event.processed_at is not null
      and old_event.received_at < now() - interval '15 days';
  end if;

  return null;
end;
$$;

revoke all on function public.compact_edge_sync_inbox_after_materialize()
  from public, anon, authenticated;
grant execute on function public.compact_edge_sync_inbox_after_materialize()
  to service_role;

drop trigger if exists zz_compact_edge_sync_inbox_after_materialize
  on public.edge_exam_sync_inbox;
create trigger zz_compact_edge_sync_inbox_after_materialize
after insert on public.edge_exam_sync_inbox
for each row execute function public.compact_edge_sync_inbox_after_materialize();

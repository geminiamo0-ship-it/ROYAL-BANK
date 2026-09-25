begin;

alter table public.ai_usage_events
  add column if not exists cost_usd numeric(18,10) not null default 0
  check (cost_usd >= 0);

create index if not exists ai_usage_events_occurred_at
  on public.ai_usage_events (occurred_at desc);

commit;

alter table public.edge_exam_sessions
  add column if not exists categories text[],
  add column if not exists question_ids bigint[] not null default '{}'::bigint[],
  add column if not exists answered_question_ids bigint[] not null default '{}'::bigint[],
  add column if not exists activity_counted boolean not null default false;

create table if not exists public.edge_user_question_state (
  user_id uuid not null,
  question_id bigint not null,
  answer_state text check (answer_state in ('correct', 'incorrect')),
  last_answered_at timestamptz,
  last_session_id uuid,
  updated_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

create index if not exists idx_edge_user_question_state_user_answered
  on public.edge_user_question_state(user_id, last_answered_at desc nulls last);

create table if not exists public.edge_user_bank_daily (
  user_id uuid not null,
  question_bank_id bigint not null,
  activity_date date not null,
  answered_count integer not null default 0 check (answered_count >= 0),
  correct_count integer not null default 0 check (correct_count >= 0 and correct_count <= answered_count),
  updated_at timestamptz not null default now(),
  primary key (user_id, question_bank_id, activity_date)
);

create index if not exists idx_edge_user_bank_daily_user_bank_date
  on public.edge_user_bank_daily(user_id, question_bank_id, activity_date desc);

alter table public.edge_user_question_state enable row level security;
alter table public.edge_user_bank_daily enable row level security;
revoke all on public.edge_user_question_state from public, anon, authenticated;
revoke all on public.edge_user_bank_daily from public, anon, authenticated;
grant select on public.edge_user_question_state to authenticated;
grant select on public.edge_user_bank_daily to authenticated;
grant select, insert, update, delete on public.edge_user_question_state to service_role;
grant select, insert, update, delete on public.edge_user_bank_daily to service_role;

drop policy if exists edge_user_question_state_owner_select on public.edge_user_question_state;
create policy edge_user_question_state_owner_select on public.edge_user_question_state
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists edge_user_bank_daily_owner_select on public.edge_user_bank_daily;
create policy edge_user_bank_daily_owner_select on public.edge_user_bank_daily
for select to authenticated using ((select auth.uid()) = user_id);

update public.edge_exam_sessions s
set question_ids = coalesce((
      select array_agg(q.question_id order by q.sort_order)
      from public.edge_exam_session_questions q
      where q.session_id = s.session_id
    ), s.question_ids),
    answered_question_ids = coalesce((
      select array_agg(a.question_id order by a.answered_at nulls last, a.question_id)
      from public.edge_exam_answers a
      where a.session_id = s.session_id
        and a.selected_option_id is not null
    ), s.answered_question_ids)
where cardinality(s.question_ids) = 0
   or cardinality(s.answered_question_ids) = 0;

insert into public.edge_user_question_state(
  user_id, question_id, answer_state, last_answered_at, last_session_id, updated_at
)
select distinct on (a.user_id, a.question_id)
  a.user_id,
  a.question_id,
  case when a.is_correct then 'correct' else 'incorrect' end,
  a.answered_at,
  a.session_id,
  now()
from public.edge_exam_answers a
where a.finalized = true
  and a.selected_option_id is not null
  and a.is_correct is not null
order by a.user_id, a.question_id, a.answered_at desc nulls last, a.stream_version desc
on conflict (user_id, question_id) do update set
  answer_state = excluded.answer_state,
  last_answered_at = excluded.last_answered_at,
  last_session_id = excluded.last_session_id,
  updated_at = now()
where public.edge_user_question_state.last_answered_at is null
   or excluded.last_answered_at >= public.edge_user_question_state.last_answered_at;

drop trigger if exists zz_materialize_edge_exam_completion_questions on public.edge_exam_sync_inbox;

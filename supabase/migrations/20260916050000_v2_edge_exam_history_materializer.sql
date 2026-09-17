create table if not exists public.edge_exam_sessions (
  session_id uuid primary key,
  user_id uuid not null,
  question_bank_id bigint,
  session_type text,
  release_id text,
  started_at timestamptz,
  deadline_at timestamptz,
  suspended_at timestamptz,
  completed_at timestamptz,
  completion_reason text,
  total_questions integer,
  correct_count integer,
  incorrect_count integer,
  score_percentage real,
  version bigint not null default 0 check (version >= 0),
  synced_at timestamptz not null default now()
);

create index if not exists idx_edge_exam_sessions_user_started
  on public.edge_exam_sessions(user_id, started_at desc nulls last);
create index if not exists idx_edge_exam_sessions_user_bank
  on public.edge_exam_sessions(user_id, question_bank_id, completed_at desc nulls last);

create table if not exists public.edge_exam_session_questions (
  session_id uuid not null,
  user_id uuid not null,
  question_id bigint not null,
  sort_order integer not null check (sort_order >= 0),
  synced_at timestamptz not null default now(),
  primary key (session_id, question_id),
  unique (session_id, sort_order)
);
create index if not exists idx_edge_exam_session_questions_user_question
  on public.edge_exam_session_questions(user_id, question_id);

create table if not exists public.edge_exam_answers (
  session_id uuid not null,
  user_id uuid not null,
  question_id bigint not null,
  selected_option_id bigint,
  is_correct boolean,
  time_spent_seconds integer not null default 0 check (time_spent_seconds >= 0),
  revision integer not null default 0 check (revision >= 0),
  stream_version bigint not null default 0 check (stream_version >= 0),
  finalized boolean not null default false,
  answered_at timestamptz,
  synced_at timestamptz not null default now(),
  primary key (session_id, question_id)
);
create index if not exists idx_edge_exam_answers_user_question
  on public.edge_exam_answers(user_id, question_id, finalized, is_correct);
create index if not exists idx_edge_exam_answers_session
  on public.edge_exam_answers(session_id, stream_version);

create table if not exists public.edge_exam_flags (
  user_id uuid not null,
  question_id bigint not null,
  flagged boolean not null,
  updated_at timestamptz not null,
  synced_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

alter table public.edge_exam_sessions enable row level security;
alter table public.edge_exam_session_questions enable row level security;
alter table public.edge_exam_answers enable row level security;
alter table public.edge_exam_flags enable row level security;

revoke all on public.edge_exam_sessions from public, anon, authenticated;
revoke all on public.edge_exam_session_questions from public, anon, authenticated;
revoke all on public.edge_exam_answers from public, anon, authenticated;
revoke all on public.edge_exam_flags from public, anon, authenticated;

grant select on public.edge_exam_sessions to authenticated;
grant select on public.edge_exam_session_questions to authenticated;
grant select on public.edge_exam_answers to authenticated;
grant select on public.edge_exam_flags to authenticated;
grant select, insert, update, delete on public.edge_exam_sessions to service_role;
grant select, insert, update, delete on public.edge_exam_session_questions to service_role;
grant select, insert, update, delete on public.edge_exam_answers to service_role;
grant select, insert, update, delete on public.edge_exam_flags to service_role;

drop policy if exists edge_exam_sessions_owner_select on public.edge_exam_sessions;
create policy edge_exam_sessions_owner_select on public.edge_exam_sessions
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists edge_exam_session_questions_owner_select on public.edge_exam_session_questions;
create policy edge_exam_session_questions_owner_select on public.edge_exam_session_questions
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists edge_exam_answers_owner_select on public.edge_exam_answers;
create policy edge_exam_answers_owner_select on public.edge_exam_answers
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists edge_exam_flags_owner_select on public.edge_exam_flags;
create policy edge_exam_flags_owner_select on public.edge_exam_flags
for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.materialize_edge_exam_sync_inbox_row()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_session uuid;
  v_version bigint := greatest(0, new.stream_version);
  v_payload jsonb := new.payload;
  v_total integer;
  v_correct integer;
  v_incorrect integer;
  v_answer jsonb;
  v_question jsonb;
  v_sort integer;
begin
  v_user := new.user_id::uuid;
  if new.session_id is not null then v_session := new.session_id::uuid; end if;

  if new.event_type = 'session.created' then
    insert into public.edge_exam_sessions(
      session_id,user_id,question_bank_id,session_type,release_id,started_at,deadline_at,total_questions,version,synced_at
    ) values (
      (v_payload->>'session_id')::uuid,
      v_user,
      nullif(v_payload->>'bank_id','')::bigint,
      nullif(v_payload->>'session_type',''),
      nullif(v_payload->>'release_id',''),
      nullif(v_payload->>'started_at','')::timestamptz,
      nullif(v_payload->>'deadline_at','')::timestamptz,
      nullif(v_payload->>'total_questions','')::integer,
      coalesce(nullif(v_payload->>'version','')::bigint,v_version),
      now()
    )
    on conflict (session_id) do update set
      user_id = excluded.user_id,
      question_bank_id = coalesce(edge_exam_sessions.question_bank_id,excluded.question_bank_id),
      session_type = coalesce(edge_exam_sessions.session_type,excluded.session_type),
      release_id = coalesce(edge_exam_sessions.release_id,excluded.release_id),
      started_at = coalesce(edge_exam_sessions.started_at,excluded.started_at),
      deadline_at = coalesce(edge_exam_sessions.deadline_at,excluded.deadline_at),
      total_questions = coalesce(edge_exam_sessions.total_questions,excluded.total_questions),
      version = greatest(edge_exam_sessions.version,excluded.version),
      synced_at = now();

    v_sort := 0;
    for v_question in select value from jsonb_array_elements(coalesce(v_payload->'question_ids','[]'::jsonb)) loop
      insert into public.edge_exam_session_questions(session_id,user_id,question_id,sort_order,synced_at)
      values ((v_payload->>'session_id')::uuid,v_user,(v_question #>> '{}')::bigint,v_sort,now())
      on conflict (session_id,question_id) do update set
        user_id=excluded.user_id,
        sort_order=excluded.sort_order,
        synced_at=now();
      v_sort := v_sort + 1;
    end loop;

  elsif new.event_type in ('answer.saved','answer.finalized') then
    insert into public.edge_exam_answers(
      session_id,user_id,question_id,selected_option_id,is_correct,time_spent_seconds,revision,stream_version,finalized,answered_at,synced_at
    ) values (
      (v_payload->>'session_id')::uuid,
      v_user,
      (v_payload->>'question_id')::bigint,
      nullif(v_payload->>'selected_option_id','')::bigint,
      case when v_payload ? 'is_correct' and v_payload->'is_correct' <> 'null'::jsonb then (v_payload->>'is_correct')::boolean else null end,
      greatest(0,coalesce(nullif(v_payload->>'time_spent_seconds','')::integer,0)),
      greatest(0,coalesce(nullif(v_payload->>'revision','')::integer,0)),
      coalesce(nullif(v_payload->>'version','')::bigint,v_version),
      new.event_type='answer.finalized',
      new.occurred_at,
      now()
    )
    on conflict (session_id,question_id) do update set
      user_id=excluded.user_id,
      selected_option_id=excluded.selected_option_id,
      is_correct=case when excluded.stream_version >= edge_exam_answers.stream_version then excluded.is_correct else edge_exam_answers.is_correct end,
      time_spent_seconds=case when excluded.stream_version >= edge_exam_answers.stream_version then excluded.time_spent_seconds else edge_exam_answers.time_spent_seconds end,
      revision=case when excluded.stream_version >= edge_exam_answers.stream_version then greatest(edge_exam_answers.revision,excluded.revision) else edge_exam_answers.revision end,
      stream_version=greatest(edge_exam_answers.stream_version,excluded.stream_version),
      finalized=case when excluded.stream_version >= edge_exam_answers.stream_version then (edge_exam_answers.finalized or excluded.finalized) else edge_exam_answers.finalized end,
      answered_at=case when excluded.stream_version >= edge_exam_answers.stream_version then excluded.answered_at else edge_exam_answers.answered_at end,
      synced_at=now();

  elsif new.event_type = 'session.suspended' then
    insert into public.edge_exam_sessions(session_id,user_id,suspended_at,version,synced_at)
    values ((v_payload->>'session_id')::uuid,v_user,nullif(v_payload->>'suspended_at','')::timestamptz,coalesce(nullif(v_payload->>'version','')::bigint,v_version),now())
    on conflict (session_id) do update set
      user_id=excluded.user_id,
      suspended_at=case when excluded.version >= edge_exam_sessions.version then excluded.suspended_at else edge_exam_sessions.suspended_at end,
      version=greatest(edge_exam_sessions.version,excluded.version),
      synced_at=now();

  elsif new.event_type = 'session.resumed' then
    insert into public.edge_exam_sessions(session_id,user_id,suspended_at,version,synced_at)
    values ((v_payload->>'session_id')::uuid,v_user,null,coalesce(nullif(v_payload->>'version','')::bigint,v_version),now())
    on conflict (session_id) do update set
      user_id=excluded.user_id,
      suspended_at=case when excluded.version >= edge_exam_sessions.version then null else edge_exam_sessions.suspended_at end,
      version=greatest(edge_exam_sessions.version,excluded.version),
      synced_at=now();

  elsif new.event_type = 'session.completed' then
    v_total := coalesce(nullif(v_payload->>'total_questions','')::integer,0);
    v_correct := coalesce(nullif(v_payload->>'correct_count','')::integer,0);
    v_incorrect := coalesce(nullif(v_payload->>'incorrect_count','')::integer,greatest(0,v_total-v_correct));

    insert into public.edge_exam_sessions(
      session_id,user_id,question_bank_id,session_type,release_id,started_at,completed_at,completion_reason,total_questions,correct_count,incorrect_count,score_percentage,suspended_at,version,synced_at
    ) values (
      (v_payload->>'session_id')::uuid,v_user,nullif(v_payload->>'bank_id','')::bigint,nullif(v_payload->>'session_type',''),nullif(v_payload->>'release_id',''),
      nullif(v_payload->>'started_at','')::timestamptz,nullif(v_payload->>'completed_at','')::timestamptz,nullif(v_payload->>'completion_reason',''),v_total,v_correct,v_incorrect,
      case when v_total>0 then round((v_correct::numeric/v_total::numeric)*100,2)::real else 0 end,
      null,
      coalesce(nullif(v_payload->>'version','')::bigint,v_version),now()
    )
    on conflict (session_id) do update set
      user_id=excluded.user_id,
      question_bank_id=coalesce(edge_exam_sessions.question_bank_id,excluded.question_bank_id),
      session_type=coalesce(edge_exam_sessions.session_type,excluded.session_type),
      release_id=coalesce(edge_exam_sessions.release_id,excluded.release_id),
      started_at=coalesce(edge_exam_sessions.started_at,excluded.started_at),
      completed_at=case when excluded.version >= edge_exam_sessions.version then excluded.completed_at else edge_exam_sessions.completed_at end,
      completion_reason=case when excluded.version >= edge_exam_sessions.version then excluded.completion_reason else edge_exam_sessions.completion_reason end,
      total_questions=case when excluded.version >= edge_exam_sessions.version then excluded.total_questions else edge_exam_sessions.total_questions end,
      correct_count=case when excluded.version >= edge_exam_sessions.version then excluded.correct_count else edge_exam_sessions.correct_count end,
      incorrect_count=case when excluded.version >= edge_exam_sessions.version then excluded.incorrect_count else edge_exam_sessions.incorrect_count end,
      score_percentage=case when excluded.version >= edge_exam_sessions.version then excluded.score_percentage else edge_exam_sessions.score_percentage end,
      suspended_at=case when excluded.version >= edge_exam_sessions.version then null else edge_exam_sessions.suspended_at end,
      version=greatest(edge_exam_sessions.version,excluded.version),
      synced_at=now();

    for v_answer in select value from jsonb_array_elements(coalesce(v_payload->'answers','[]'::jsonb)) loop
      insert into public.edge_exam_answers(
        session_id,user_id,question_id,selected_option_id,is_correct,time_spent_seconds,revision,stream_version,finalized,answered_at,synced_at
      ) values (
        (v_payload->>'session_id')::uuid,v_user,(v_answer->>'question_id')::bigint,nullif(v_answer->>'selected_option_id','')::bigint,
        coalesce((v_answer->>'is_correct')::boolean,false),greatest(0,coalesce(nullif(v_answer->>'time_spent_seconds','')::integer,0)),0,
        coalesce(nullif(v_payload->>'version','')::bigint,v_version),true,nullif(v_payload->>'completed_at','')::timestamptz,now()
      )
      on conflict (session_id,question_id) do update set
        user_id=excluded.user_id,
        selected_option_id=excluded.selected_option_id,
        is_correct=case when excluded.stream_version >= edge_exam_answers.stream_version then excluded.is_correct else edge_exam_answers.is_correct end,
        time_spent_seconds=case when excluded.stream_version >= edge_exam_answers.stream_version then excluded.time_spent_seconds else edge_exam_answers.time_spent_seconds end,
        stream_version=greatest(edge_exam_answers.stream_version,excluded.stream_version),
        finalized=case when excluded.stream_version >= edge_exam_answers.stream_version then true else edge_exam_answers.finalized end,
        synced_at=now();
    end loop;

  elsif new.event_type = 'question.flagged' then
    insert into public.edge_exam_flags(user_id,question_id,flagged,updated_at,synced_at)
    values (v_user,(v_payload->>'question_id')::bigint,coalesce((v_payload->>'flagged')::boolean,false),new.occurred_at,now())
    on conflict (user_id,question_id) do update set
      flagged=excluded.flagged,
      updated_at=excluded.updated_at,
      synced_at=now()
    where excluded.updated_at >= edge_exam_flags.updated_at;
  end if;

  update public.edge_exam_sync_inbox
    set processed_at=now(), process_attempts=process_attempts+1, last_error=null
    where event_id=new.event_id;
  return new;
end;
$$;

revoke all on function public.materialize_edge_exam_sync_inbox_row() from public, anon, authenticated;
grant execute on function public.materialize_edge_exam_sync_inbox_row() to service_role;

drop trigger if exists materialize_edge_exam_sync_inbox_insert on public.edge_exam_sync_inbox;
create trigger materialize_edge_exam_sync_inbox_insert
after insert on public.edge_exam_sync_inbox
for each row execute function public.materialize_edge_exam_sync_inbox_row();

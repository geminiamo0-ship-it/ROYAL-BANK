create or replace function public.get_user_question_states(p_bank_id bigint)
returns table(question_id bigint,answer_state text,is_suspended boolean,is_flagged boolean,is_new boolean)
language plpgsql stable security definer
set search_path to 'public','pg_temp'
set row_security to 'off'
as $$
begin
  if auth.uid() is null or not public.can_access_question_bank(p_bank_id) then
    raise exception 'Question bank access denied';
  end if;

  return query
  with bank_questions as (
    select qbq.question_id from public.question_bank_questions qbq where qbq.question_bank_id=p_bank_id
  ),
  answer_candidates as (
    select ua.question_id,ua.is_correct,ua.answered_at,0 as source_rank
    from public.user_answers ua
    join public.test_sessions s on s.id=ua.test_session_id
    where ua.user_id=auth.uid() and (s.is_completed=true or s.session_type in ('standard','tutor'))
    union all
    select e.question_id,(e.answer_state='correct'),e.last_answered_at,1
    from public.edge_user_question_state e
    where e.user_id=auth.uid() and e.answer_state is not null
  ),
  finalized_latest as (
    select distinct on (candidate.question_id)
      candidate.question_id,candidate.is_correct
    from answer_candidates candidate
    order by candidate.question_id,candidate.answered_at desc nulls last,candidate.source_rank desc
  ),
  legacy_suspended as (
    select distinct tsq.question_id
    from public.test_session_questions tsq
    join public.test_sessions ts on ts.id=tsq.test_session_id
    left join public.user_answers ua on ua.test_session_id=ts.id and ua.question_id=tsq.question_id and ua.user_id=auth.uid()
    where ts.user_id=auth.uid() and ts.question_bank_id=p_bank_id and ts.is_completed=false and ua.id is null
  ),
  edge_suspended as (
    select distinct q.question_id
    from public.edge_exam_sessions es
    cross join lateral unnest(es.question_ids) as q(question_id)
    where es.user_id=auth.uid() and es.question_bank_id=p_bank_id and es.completed_at is null
      and not (q.question_id=any(es.answered_question_ids))
  ),
  suspended as (
    select question_id from legacy_suspended union select question_id from edge_suspended
  ),
  legacy_active_locked as (
    select distinct tsq.question_id
    from public.test_session_questions tsq join public.test_sessions ts on ts.id=tsq.test_session_id
    where ts.user_id=auth.uid() and ts.question_bank_id=p_bank_id and ts.is_completed=false
  ),
  edge_active_locked as (
    select distinct q.question_id
    from public.edge_exam_sessions es cross join lateral unnest(es.question_ids) as q(question_id)
    where es.user_id=auth.uid() and es.question_bank_id=p_bank_id and es.completed_at is null
  ),
  active_locked as (
    select question_id from legacy_active_locked union select question_id from edge_active_locked
  ),
  legacy_flags as (
    select f.question_id,f.flagged_at from public.user_question_flags f where f.user_id=auth.uid()
  )
  select bq.question_id,
    case when latest.question_id is null then null when latest.is_correct then 'correct' else 'incorrect' end,
    suspended.question_id is not null,
    case
      when ef.question_id is not null and (lf.question_id is null or ef.updated_at>=lf.flagged_at) then ef.flagged
      else lf.question_id is not null
    end,
    latest.question_id is null and active_locked.question_id is null
  from bank_questions bq
  left join finalized_latest latest on latest.question_id=bq.question_id
  left join suspended on suspended.question_id=bq.question_id
  left join active_locked on active_locked.question_id=bq.question_id
  left join legacy_flags lf on lf.question_id=bq.question_id
  left join public.edge_exam_flags ef on ef.user_id=auth.uid() and ef.question_id=bq.question_id;
end;
$$;

revoke all on function public.get_user_question_states(bigint) from public,anon;
grant execute on function public.get_user_question_states(bigint) to authenticated,service_role;

create or replace function public.get_my_bank_sessions(p_bank_id bigint,p_limit integer default 100)
returns table(
  id uuid,started_at timestamptz,completed_at timestamptz,categories text[],total_questions integer,
  session_type text,is_completed boolean,score_percentage real,answered_count bigint
)
language plpgsql security definer
set search_path to 'public','pg_temp'
set row_security to 'off'
as $$
begin
  if auth.uid() is null or not public.is_active_user() then raise exception 'Active authentication required'; end if;

  return query
  select combined.id,combined.started_at,combined.completed_at,combined.categories,combined.total_questions,
         combined.session_type,combined.is_completed,combined.score_percentage,combined.answered_count
  from (
    select ts.id,ts.started_at,ts.completed_at,ts.categories,ts.total_questions,ts.session_type,ts.is_completed,
           ts.score_percentage,count(ua.id)::bigint as answered_count
    from public.test_sessions ts
    left join public.user_answers ua on ua.test_session_id=ts.id and ua.user_id=auth.uid()
    where ts.user_id=auth.uid() and ts.question_bank_id=p_bank_id
    group by ts.id,ts.started_at,ts.completed_at,ts.categories,ts.total_questions,ts.session_type,ts.is_completed,ts.score_percentage
    union all
    select es.session_id,es.started_at,es.completed_at,es.categories,coalesce(es.total_questions,cardinality(es.question_ids)),
           coalesce(es.session_type,'standard'),es.completed_at is not null,es.score_percentage,
           cardinality(es.answered_question_ids)::bigint
    from public.edge_exam_sessions es
    where es.user_id=auth.uid() and es.question_bank_id=p_bank_id
  ) combined
  order by combined.started_at desc nulls last
  limit least(greatest(coalesce(p_limit,100),1),200);
end;
$$;

revoke all on function public.get_my_bank_sessions(bigint,integer) from public;
grant execute on function public.get_my_bank_sessions(bigint,integer) to authenticated;

create or replace function public.get_my_bank_activity_rollup(p_bank_id bigint)
returns jsonb
language plpgsql stable security definer
set search_path to 'public','pg_temp'
set row_security to 'off'
as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_access_question_bank(p_bank_id) then raise exception 'Question bank access denied'; end if;

  with legacy_daily as (
    select ua.answered_at::date as activity_date,count(*)::int as answered_count,
           count(*) filter (where ua.is_correct)::int as correct_count
    from public.user_answers ua
    where ua.user_id=auth.uid()
      and exists(select 1 from public.question_bank_questions qbq where qbq.question_bank_id=p_bank_id and qbq.question_id=ua.question_id)
    group by ua.answered_at::date
  ),
  combined_daily as (
    select rows.activity_date,sum(rows.answered_count)::int as answered_count,sum(rows.correct_count)::int as correct_count
    from (
      select * from legacy_daily
      union all
      select d.activity_date,d.answered_count,d.correct_count
      from public.edge_user_bank_daily d where d.user_id=auth.uid() and d.question_bank_id=p_bank_id
    ) rows
    group by rows.activity_date
  ),
  recent as (
    select * from combined_daily where activity_date>=current_date-97
  ),
  groups as (
    select activity_date,activity_date-(row_number() over(order by activity_date))::int as group_key from combined_daily
  ),
  streak as (
    select case when max(activity_date) is null or max(activity_date)<current_date-1 then 0
      else coalesce((select count(*)::int from groups g where g.group_key=(select anchor.group_key from groups anchor where anchor.activity_date=(select max(activity_date) from combined_daily) limit 1)),0)
      end as streak_days
    from combined_daily
  )
  select jsonb_build_object(
    'answered_today',coalesce((select answered_count from combined_daily where activity_date=current_date),0),
    'streak_days',(select streak_days from streak),
    'activity',coalesce((select jsonb_agg(jsonb_build_object(
      'date',activity_date,'answered',answered_count,'correct',correct_count,
      'accuracy',case when answered_count>0 then round(correct_count::numeric/answered_count*100,1) else null end
    ) order by activity_date) from recent),'[]'::jsonb)
  ) into v_result;
  return coalesce(v_result,jsonb_build_object('answered_today',0,'streak_days',0,'activity','[]'::jsonb));
end;
$$;

revoke all on function public.get_my_bank_activity_rollup(bigint) from public,anon;
grant execute on function public.get_my_bank_activity_rollup(bigint) to authenticated,service_role;

create or replace function public.get_question_bank_performance_v2(p_bank_id bigint)
returns jsonb
language plpgsql security definer
set search_path to 'public','pg_temp'
set row_security to 'off'
as $$
declare
  v_base jsonb;
  v_activity jsonb;
begin
  v_base:=public.get_question_bank_performance(p_bank_id);
  v_activity:=public.get_my_bank_activity_rollup(p_bank_id);
  return v_base || jsonb_build_object(
    'answered_today',coalesce((v_activity->>'answered_today')::int,0),
    'streak_days',coalesce((v_activity->>'streak_days')::int,0),
    'activity',coalesce(v_activity->'activity','[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_question_bank_performance_v2(bigint) from public,anon;
grant execute on function public.get_question_bank_performance_v2(bigint) to authenticated,service_role;

comment on table public.edge_user_question_state is
  'Bounded V2 latest-question state: one row per user/question. Exact per-session attempt detail remains in R2 archives.';
comment on table public.edge_user_bank_daily is
  'Bounded V2 daily activity rollup used for activity charts/streaks without raw answer-attempt retention.';

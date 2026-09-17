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
    select ls.question_id as question_id from legacy_suspended ls
    union
    select esu.question_id as question_id from edge_suspended esu
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
    select lal.question_id as question_id from legacy_active_locked lal
    union
    select eal.question_id as question_id from edge_active_locked eal
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

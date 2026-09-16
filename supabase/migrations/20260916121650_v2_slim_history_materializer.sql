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
  v_bank bigint;
  v_session_type text;
  v_completed_at timestamptz;
  v_total integer;
  v_correct integer;
  v_incorrect integer;
  v_answered integer := 0;
  v_activity_correct integer := 0;
  v_activity_counted boolean := false;
  v_answer jsonb;
  v_question_ids bigint[] := '{}'::bigint[];
  v_answered_ids bigint[] := '{}'::bigint[];
  v_categories text[] := null;
begin
  v_user := new.user_id::uuid;
  if new.session_id is not null then v_session := new.session_id::uuid; end if;

  if v_payload ? 'question_ids' then
    select coalesce(array_agg((item.value #>> '{}')::bigint order by item.ordinality), '{}'::bigint[])
    into v_question_ids
    from jsonb_array_elements(coalesce(v_payload->'question_ids', '[]'::jsonb)) with ordinality as item(value, ordinality);
  end if;

  if v_payload ? 'categories' then
    select coalesce(array_agg(item.value #>> '{}' order by item.ordinality), '{}'::text[])
    into v_categories
    from jsonb_array_elements(coalesce(v_payload->'categories', '[]'::jsonb)) with ordinality as item(value, ordinality);
  end if;

  if new.event_type = 'session.created' then
    v_session := (v_payload->>'session_id')::uuid;
    v_bank := nullif(v_payload->>'bank_id','')::bigint;
    v_session_type := nullif(v_payload->>'session_type','');

    insert into public.edge_exam_sessions(
      session_id,user_id,question_bank_id,session_type,release_id,started_at,deadline_at,
      total_questions,version,categories,question_ids,answered_question_ids,synced_at
    ) values (
      v_session,v_user,v_bank,v_session_type,nullif(v_payload->>'release_id',''),
      nullif(v_payload->>'started_at','')::timestamptz,nullif(v_payload->>'deadline_at','')::timestamptz,
      nullif(v_payload->>'total_questions','')::integer,
      coalesce(nullif(v_payload->>'version','')::bigint,v_version),v_categories,v_question_ids,'{}'::bigint[],now()
    )
    on conflict (session_id) do update set
      user_id=excluded.user_id,
      question_bank_id=coalesce(public.edge_exam_sessions.question_bank_id,excluded.question_bank_id),
      session_type=coalesce(public.edge_exam_sessions.session_type,excluded.session_type),
      release_id=coalesce(public.edge_exam_sessions.release_id,excluded.release_id),
      started_at=coalesce(public.edge_exam_sessions.started_at,excluded.started_at),
      deadline_at=coalesce(public.edge_exam_sessions.deadline_at,excluded.deadline_at),
      total_questions=coalesce(public.edge_exam_sessions.total_questions,excluded.total_questions),
      categories=coalesce(public.edge_exam_sessions.categories,excluded.categories),
      question_ids=case when cardinality(excluded.question_ids)>0 then excluded.question_ids else public.edge_exam_sessions.question_ids end,
      version=greatest(public.edge_exam_sessions.version,excluded.version),
      synced_at=now();

    if v_bank is not null then
      perform public.mark_question_bank_dashboard_dirty(v_user, v_bank);
    end if;

  elsif new.event_type in ('answer.saved','answer.finalized') then
    v_session := (v_payload->>'session_id')::uuid;
    if new.event_type = 'answer.finalized'
       and nullif(v_payload->>'selected_option_id','') is not null
       and v_payload ? 'is_correct'
       and v_payload->'is_correct' <> 'null'::jsonb then
      insert into public.edge_user_question_state(
        user_id,question_id,answer_state,last_answered_at,last_session_id,updated_at
      ) values (
        v_user,(v_payload->>'question_id')::bigint,
        case when (v_payload->>'is_correct')::boolean then 'correct' else 'incorrect' end,
        new.occurred_at,v_session,now()
      )
      on conflict (user_id,question_id) do update set
        answer_state=excluded.answer_state,
        last_answered_at=excluded.last_answered_at,
        last_session_id=excluded.last_session_id,
        updated_at=now()
      where public.edge_user_question_state.last_answered_at is null
         or excluded.last_answered_at >= public.edge_user_question_state.last_answered_at;

      update public.edge_exam_sessions s
      set answered_question_ids = array(
            select distinct value
            from unnest(array_append(s.answered_question_ids,(v_payload->>'question_id')::bigint)) as valueset(value)
            order by value
          ),
          synced_at=now()
      where s.session_id=v_session and s.user_id=v_user;

      select s.question_bank_id into v_bank
      from public.edge_exam_sessions s where s.session_id=v_session and s.user_id=v_user;
      if v_bank is not null then perform public.mark_question_bank_dashboard_dirty(v_user,v_bank); end if;
    end if;

  elsif new.event_type = 'session.suspended' then
    v_session := (v_payload->>'session_id')::uuid;
    select s.question_bank_id,s.session_type into v_bank,v_session_type
    from public.edge_exam_sessions s where s.session_id=v_session and s.user_id=v_user;
    v_bank := coalesce(v_bank,nullif(v_payload->>'bank_id','')::bigint);
    v_session_type := coalesce(v_session_type,nullif(v_payload->>'session_type',''));

    if v_payload ? 'answers' then
      for v_answer in select value from jsonb_array_elements(coalesce(v_payload->'answers','[]'::jsonb)) loop
        if nullif(v_answer->>'selected_option_id','') is not null then
          v_answered_ids := array_append(v_answered_ids,(v_answer->>'question_id')::bigint);
          if v_session_type in ('standard','tutor') and v_answer ? 'is_correct' then
            insert into public.edge_user_question_state(
              user_id,question_id,answer_state,last_answered_at,last_session_id,updated_at
            ) values (
              v_user,(v_answer->>'question_id')::bigint,
              case when (v_answer->>'is_correct')::boolean then 'correct' else 'incorrect' end,
              new.occurred_at,v_session,now()
            )
            on conflict (user_id,question_id) do update set
              answer_state=excluded.answer_state,
              last_answered_at=excluded.last_answered_at,
              last_session_id=excluded.last_session_id,
              updated_at=now()
            where public.edge_user_question_state.last_answered_at is null
               or excluded.last_answered_at >= public.edge_user_question_state.last_answered_at;
          end if;
        end if;
      end loop;
    end if;

    update public.edge_exam_sessions s set
      suspended_at=nullif(v_payload->>'suspended_at','')::timestamptz,
      answered_question_ids=case when v_payload ? 'answers' then v_answered_ids else s.answered_question_ids end,
      version=greatest(s.version,coalesce(nullif(v_payload->>'version','')::bigint,v_version)),
      synced_at=now()
    where s.session_id=v_session and s.user_id=v_user;
    if v_bank is not null then perform public.mark_question_bank_dashboard_dirty(v_user,v_bank); end if;

  elsif new.event_type = 'session.resumed' then
    v_session := (v_payload->>'session_id')::uuid;
    update public.edge_exam_sessions s set
      suspended_at=null,
      version=greatest(s.version,coalesce(nullif(v_payload->>'version','')::bigint,v_version)),
      synced_at=now()
    where s.session_id=v_session and s.user_id=v_user;

  elsif new.event_type = 'session.completed' then
    v_session := (v_payload->>'session_id')::uuid;
    v_bank := nullif(v_payload->>'bank_id','')::bigint;
    v_session_type := nullif(v_payload->>'session_type','');
    v_completed_at := nullif(v_payload->>'completed_at','')::timestamptz;
    v_total := coalesce(nullif(v_payload->>'total_questions','')::integer,0);
    v_correct := coalesce(nullif(v_payload->>'correct_count','')::integer,0);
    v_incorrect := coalesce(nullif(v_payload->>'incorrect_count','')::integer,greatest(0,v_total-v_correct));

    select coalesce(s.activity_counted,false) into v_activity_counted
    from public.edge_exam_sessions s where s.session_id=v_session;

    if v_payload ? 'answers' then
      for v_answer in select value from jsonb_array_elements(coalesce(v_payload->'answers','[]'::jsonb)) loop
        if nullif(v_answer->>'selected_option_id','') is not null then
          v_answered := v_answered + 1;
          v_answered_ids := array_append(v_answered_ids,(v_answer->>'question_id')::bigint);
          if coalesce((v_answer->>'is_correct')::boolean,false) then v_activity_correct := v_activity_correct + 1; end if;

          insert into public.edge_user_question_state(
            user_id,question_id,answer_state,last_answered_at,last_session_id,updated_at
          ) values (
            v_user,(v_answer->>'question_id')::bigint,
            case when coalesce((v_answer->>'is_correct')::boolean,false) then 'correct' else 'incorrect' end,
            coalesce(v_completed_at,new.occurred_at),v_session,now()
          )
          on conflict (user_id,question_id) do update set
            answer_state=excluded.answer_state,
            last_answered_at=excluded.last_answered_at,
            last_session_id=excluded.last_session_id,
            updated_at=now()
          where public.edge_user_question_state.last_answered_at is null
             or excluded.last_answered_at >= public.edge_user_question_state.last_answered_at;
        end if;
      end loop;
    end if;

    insert into public.edge_exam_sessions(
      session_id,user_id,question_bank_id,session_type,release_id,started_at,completed_at,
      completion_reason,total_questions,correct_count,incorrect_count,score_percentage,suspended_at,
      version,question_ids,answered_question_ids,activity_counted,synced_at
    ) values (
      v_session,v_user,v_bank,v_session_type,nullif(v_payload->>'release_id',''),
      nullif(v_payload->>'started_at','')::timestamptz,v_completed_at,nullif(v_payload->>'completion_reason',''),
      v_total,v_correct,v_incorrect,
      case when v_total>0 then round((v_correct::numeric/v_total::numeric)*100,2)::real else 0 end,
      null,coalesce(nullif(v_payload->>'version','')::bigint,v_version),v_question_ids,v_answered_ids,
      coalesce(v_activity_counted,false),now()
    )
    on conflict (session_id) do update set
      user_id=excluded.user_id,
      question_bank_id=coalesce(public.edge_exam_sessions.question_bank_id,excluded.question_bank_id),
      session_type=coalesce(public.edge_exam_sessions.session_type,excluded.session_type),
      release_id=coalesce(public.edge_exam_sessions.release_id,excluded.release_id),
      started_at=coalesce(public.edge_exam_sessions.started_at,excluded.started_at),
      completed_at=case when excluded.version>=public.edge_exam_sessions.version then excluded.completed_at else public.edge_exam_sessions.completed_at end,
      completion_reason=case when excluded.version>=public.edge_exam_sessions.version then excluded.completion_reason else public.edge_exam_sessions.completion_reason end,
      total_questions=case when excluded.version>=public.edge_exam_sessions.version then excluded.total_questions else public.edge_exam_sessions.total_questions end,
      correct_count=case when excluded.version>=public.edge_exam_sessions.version then excluded.correct_count else public.edge_exam_sessions.correct_count end,
      incorrect_count=case when excluded.version>=public.edge_exam_sessions.version then excluded.incorrect_count else public.edge_exam_sessions.incorrect_count end,
      score_percentage=case when excluded.version>=public.edge_exam_sessions.version then excluded.score_percentage else public.edge_exam_sessions.score_percentage end,
      question_ids=case when cardinality(excluded.question_ids)>0 then excluded.question_ids else public.edge_exam_sessions.question_ids end,
      answered_question_ids=excluded.answered_question_ids,
      suspended_at=null,
      version=greatest(public.edge_exam_sessions.version,excluded.version),
      synced_at=now();

    if not coalesce(v_activity_counted,false) and v_bank is not null and v_completed_at is not null then
      insert into public.edge_user_bank_daily(
        user_id,question_bank_id,activity_date,answered_count,correct_count,updated_at
      ) values (
        v_user,v_bank,v_completed_at::date,v_answered,v_activity_correct,now()
      )
      on conflict (user_id,question_bank_id,activity_date) do update set
        answered_count=public.edge_user_bank_daily.answered_count+excluded.answered_count,
        correct_count=public.edge_user_bank_daily.correct_count+excluded.correct_count,
        updated_at=now();

      update public.edge_exam_sessions set activity_counted=true where session_id=v_session;
    end if;

    delete from public.edge_exam_answers where session_id=v_session;
    delete from public.edge_exam_session_questions where session_id=v_session;

    delete from public.edge_exam_sessions old_session
    where old_session.session_id in (
      select stale.session_id
      from public.edge_exam_sessions stale
      where stale.user_id=v_user and stale.completed_at is not null
      order by stale.started_at desc nulls last, stale.session_id desc
      offset 200
    );

    if v_bank is not null then perform public.mark_question_bank_dashboard_dirty(v_user,v_bank); end if;

  elsif new.event_type = 'question.flagged' then
    insert into public.edge_exam_flags(user_id,question_id,flagged,updated_at,synced_at)
    values (v_user,(v_payload->>'question_id')::bigint,coalesce((v_payload->>'flagged')::boolean,false),new.occurred_at,now())
    on conflict (user_id,question_id) do update set
      flagged=excluded.flagged,
      updated_at=excluded.updated_at,
      synced_at=now()
    where excluded.updated_at >= public.edge_exam_flags.updated_at;

    for v_bank in
      select qbq.question_bank_id from public.question_bank_questions qbq
      where qbq.question_id=(v_payload->>'question_id')::bigint
    loop
      perform public.mark_question_bank_dashboard_dirty(v_user,v_bank);
    end loop;
  end if;

  update public.edge_exam_sync_inbox
  set processed_at=now(),process_attempts=process_attempts+1,last_error=null
  where event_id=new.event_id;
  return new;
end;
$$;

revoke all on function public.materialize_edge_exam_sync_inbox_row() from public,anon,authenticated;
grant execute on function public.materialize_edge_exam_sync_inbox_row() to service_role;

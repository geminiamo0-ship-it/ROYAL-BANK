-- Materialize batched Durable Object answer checkpoints without restoring
-- per-answer Queue/Supabase replication. The generic inbox trigger still owns
-- processed_at bookkeeping; this trigger only applies the checkpoint payload.

create or replace function public.materialize_edge_exam_checkpoint_row()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_session uuid;
  v_bank bigint;
  v_session_type text;
  v_version bigint := greatest(0, new.stream_version);
  v_answer jsonb;
  v_answered_ids bigint[] := '{}'::bigint[];
  v_answered_at timestamptz;
begin
  if new.event_type <> 'session.checkpoint' then
    return new;
  end if;

  v_user := new.user_id::uuid;
  v_session := coalesce(
    nullif(new.payload->>'session_id', '')::uuid,
    new.session_id::uuid
  );
  v_bank := nullif(new.payload->>'bank_id', '')::bigint;
  v_session_type := nullif(new.payload->>'session_type', '');
  v_version := greatest(
    v_version,
    coalesce(nullif(new.payload->>'version', '')::bigint, 0)
  );

  for v_answer in
    select value
    from jsonb_array_elements(coalesce(new.payload->'answers', '[]'::jsonb))
  loop
    if nullif(v_answer->>'selected_option_id', '') is null then
      continue;
    end if;

    v_answered_ids := array_append(v_answered_ids, (v_answer->>'question_id')::bigint);

    if v_session_type in ('standard', 'tutor')
       and v_answer ? 'is_correct'
       and v_answer->'is_correct' <> 'null'::jsonb then
      v_answered_at := coalesce(
        nullif(v_answer->>'answered_at', '')::timestamptz,
        new.occurred_at
      );

      insert into public.edge_user_question_state(
        user_id,
        question_id,
        answer_state,
        last_answered_at,
        last_session_id,
        updated_at
      ) values (
        v_user,
        (v_answer->>'question_id')::bigint,
        case when (v_answer->>'is_correct')::boolean then 'correct' else 'incorrect' end,
        v_answered_at,
        v_session,
        now()
      )
      on conflict (user_id, question_id) do update set
        answer_state = excluded.answer_state,
        last_answered_at = excluded.last_answered_at,
        last_session_id = excluded.last_session_id,
        updated_at = now()
      where public.edge_user_question_state.last_answered_at is null
         or excluded.last_answered_at >= public.edge_user_question_state.last_answered_at;
    end if;
  end loop;

  insert into public.edge_exam_sessions(
    session_id,
    user_id,
    question_bank_id,
    session_type,
    version,
    answered_question_ids,
    synced_at
  ) values (
    v_session,
    v_user,
    v_bank,
    v_session_type,
    v_version,
    v_answered_ids,
    now()
  )
  on conflict (session_id) do update set
    user_id = excluded.user_id,
    question_bank_id = coalesce(public.edge_exam_sessions.question_bank_id, excluded.question_bank_id),
    session_type = coalesce(public.edge_exam_sessions.session_type, excluded.session_type),
    answered_question_ids = case
      when excluded.version >= public.edge_exam_sessions.version then excluded.answered_question_ids
      else public.edge_exam_sessions.answered_question_ids
    end,
    version = greatest(public.edge_exam_sessions.version, excluded.version),
    synced_at = now();

  if v_bank is not null then
    perform public.mark_question_bank_dashboard_dirty(v_user, v_bank);
  end if;

  return new;
end;
$$;

revoke all on function public.materialize_edge_exam_checkpoint_row() from public, anon, authenticated;
grant execute on function public.materialize_edge_exam_checkpoint_row() to service_role;

drop trigger if exists aa_materialize_edge_exam_checkpoint_insert on public.edge_exam_sync_inbox;
create trigger aa_materialize_edge_exam_checkpoint_insert
after insert on public.edge_exam_sync_inbox
for each row execute function public.materialize_edge_exam_checkpoint_row();

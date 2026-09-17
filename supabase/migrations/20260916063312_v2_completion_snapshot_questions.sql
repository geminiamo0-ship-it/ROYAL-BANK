create or replace function public.materialize_edge_exam_completion_questions()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_session uuid;
  v_question jsonb;
  v_sort integer := 0;
begin
  if new.event_type <> 'session.completed' then
    return new;
  end if;

  v_user := new.user_id::uuid;
  v_session := coalesce(
    nullif(new.payload->>'session_id', '')::uuid,
    nullif(new.session_id, '')::uuid
  );

  if v_session is null then
    raise exception 'session.completed payload is missing session_id';
  end if;

  for v_question in
    select value
    from jsonb_array_elements(coalesce(new.payload->'question_ids', '[]'::jsonb))
  loop
    insert into public.edge_exam_session_questions(
      session_id,
      user_id,
      question_id,
      sort_order,
      synced_at
    ) values (
      v_session,
      v_user,
      (v_question #>> '{}')::bigint,
      v_sort,
      now()
    )
    on conflict (session_id, question_id) do update set
      user_id = excluded.user_id,
      sort_order = excluded.sort_order,
      synced_at = now();

    v_sort := v_sort + 1;
  end loop;

  return new;
end;
$$;

revoke all on function public.materialize_edge_exam_completion_questions() from public, anon, authenticated;
grant execute on function public.materialize_edge_exam_completion_questions() to service_role;

drop trigger if exists zz_materialize_edge_exam_completion_questions on public.edge_exam_sync_inbox;
create trigger zz_materialize_edge_exam_completion_questions
after insert on public.edge_exam_sync_inbox
for each row execute function public.materialize_edge_exam_completion_questions();

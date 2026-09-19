-- Materialize coalesced annotation snapshots emitted by the per-user Durable Object.
-- Browser edits never wait for this path; the DO is the hot durable store and Supabase
-- remains the background durable/reporting copy.

create table if not exists public.edge_question_annotation_versions (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id bigint not null references public.questions(id) on delete cascade,
  edge_version bigint not null check (edge_version >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

alter table public.edge_question_annotation_versions enable row level security;
revoke all on table public.edge_question_annotation_versions from public, anon, authenticated;
grant select, insert, update, delete on table public.edge_question_annotation_versions to service_role;

create or replace function public.materialize_edge_annotation_checkpoint_row()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_question bigint;
  v_version bigint;
  v_current_version bigint;
  v_cleared boolean;
  v_record jsonb;
  v_surface text;
  v_content_hash text;
  v_strokes jsonb;
begin
  if new.event_type <> 'annotation.checkpoint' then
    return new;
  end if;

  v_user := new.user_id::uuid;
  v_question := nullif(new.payload->>'question_id', '')::bigint;
  v_version := greatest(
    0,
    coalesce(nullif(new.payload->>'version', '')::bigint, new.stream_version)
  );
  v_cleared := coalesce((new.payload->>'cleared')::boolean, false);

  if v_question is null or v_question <= 0 then
    raise exception 'invalid annotation checkpoint question id';
  end if;

  select edge_version
    into v_current_version
  from public.edge_question_annotation_versions
  where user_id = v_user
    and question_id = v_question
  for update;

  if found and v_current_version >= v_version then
    return new;
  end if;

  -- Each event is a complete question snapshot. Deleting first makes removed
  -- highlights/ink authoritative too, while the table constraint re-validates
  -- every payload before it can become durable state.
  delete from public.question_annotations
  where user_id = v_user
    and question_id = v_question;

  if not v_cleared then
    for v_record in
      select value
      from jsonb_array_elements(coalesce(new.payload->'records', '[]'::jsonb))
    loop
      v_surface := nullif(v_record->>'surface', '');
      v_content_hash := nullif(v_record->>'content_hash', '');
      v_strokes := coalesce(v_record->'strokes', '[]'::jsonb);

      if v_surface not in ('stem', 'options', 'explanation') then
        raise exception 'invalid annotation checkpoint surface';
      end if;
      if v_content_hash is null or v_content_hash !~ '^[0-9a-f]{64}$' then
        raise exception 'invalid annotation checkpoint content hash';
      end if;
      if not public.is_valid_question_annotation_strokes(v_strokes) then
        raise exception 'invalid annotation checkpoint strokes';
      end if;

      insert into public.question_annotations(
        user_id,
        question_id,
        surface,
        content_hash,
        strokes
      ) values (
        v_user,
        v_question,
        v_surface,
        v_content_hash,
        v_strokes
      );
    end loop;
  end if;

  insert into public.edge_question_annotation_versions(
    user_id,
    question_id,
    edge_version,
    updated_at
  ) values (
    v_user,
    v_question,
    v_version,
    now()
  )
  on conflict (user_id, question_id) do update set
    edge_version = excluded.edge_version,
    updated_at = excluded.updated_at
  where excluded.edge_version > public.edge_question_annotation_versions.edge_version;

  return new;
end;
$$;

revoke all on function public.materialize_edge_annotation_checkpoint_row() from public, anon, authenticated;
grant execute on function public.materialize_edge_annotation_checkpoint_row() to service_role;

drop trigger if exists aa_materialize_edge_annotation_checkpoint_insert on public.edge_exam_sync_inbox;
create trigger aa_materialize_edge_annotation_checkpoint_insert
after insert on public.edge_exam_sync_inbox
for each row execute function public.materialize_edge_annotation_checkpoint_row();

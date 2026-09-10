SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

COMMENT ON FUNCTION public.content_manager_import_questions(BIGINT, JSONB)
IS 'Service-role-only Royal Content Manager import. Upserts supplied questions, replaces options for supplied questions, and ensures bank mappings. Missing source questions remain untouched.';

COMMENT ON FUNCTION public.content_manager_import_articles(BIGINT, JSONB)
IS 'Service-role-only Royal Content Manager import. Upserts supplied Library articles and bank mappings. Missing source articles remain untouched.';

COMMENT ON FUNCTION public.content_manager_refresh_counts()
IS 'Service-role-only post-import refresh for question_bank_topic_counts.';

-- Persistent per-user question annotations for the exam workspace.
-- Vector strokes only; no HTML or executable content is stored.

create or replace function public.is_valid_question_annotation_strokes(p_strokes jsonb)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_stroke jsonb;
  v_point jsonb;
  v_width numeric;
  v_x numeric;
  v_y numeric;
  v_total_points integer := 0;
  v_point_count integer;
begin
  if p_strokes is null or jsonb_typeof(p_strokes) <> 'array' then
    return false;
  end if;

  if jsonb_array_length(p_strokes) > 500 or pg_column_size(p_strokes) > 262144 then
    return false;
  end if;

  for v_stroke in select value from jsonb_array_elements(p_strokes)
  loop
    if jsonb_typeof(v_stroke) <> 'object' then
      return false;
    end if;

    if coalesce(v_stroke ->> 'tool', '') not in ('pencil', 'highlighter') then
      return false;
    end if;

    if length(coalesce(v_stroke ->> 'id', '')) < 1
       or length(v_stroke ->> 'id') > 80 then
      return false;
    end if;

    if jsonb_typeof(v_stroke -> 'width') <> 'number' then
      return false;
    end if;

    v_width := (v_stroke ->> 'width')::numeric;
    if v_width < 0.5 or v_width > 48 then
      return false;
    end if;

    if jsonb_typeof(v_stroke -> 'points') <> 'array' then
      return false;
    end if;

    v_point_count := jsonb_array_length(v_stroke -> 'points');
    if v_point_count < 2 or v_point_count > 2000 then
      return false;
    end if;

    v_total_points := v_total_points + v_point_count;
    if v_total_points > 25000 then
      return false;
    end if;

    for v_point in select value from jsonb_array_elements(v_stroke -> 'points')
    loop
      if jsonb_typeof(v_point) <> 'array'
         or jsonb_array_length(v_point) <> 2
         or jsonb_typeof(v_point -> 0) <> 'number'
         or jsonb_typeof(v_point -> 1) <> 'number' then
        return false;
      end if;

      v_x := (v_point ->> 0)::numeric;
      v_y := (v_point ->> 1)::numeric;
      if v_x < 0 or v_x > 1 or v_y < 0 or v_y > 1 then
        return false;
      end if;
    end loop;
  end loop;

  return true;
exception
  when others then
    return false;
end;
$$;

create table if not exists public.question_annotations (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id bigint not null references public.questions(id) on delete cascade,
  surface text not null check (surface in ('stem', 'options', 'explanation')),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  strokes jsonb not null default '[]'::jsonb,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, question_id, surface),
  constraint question_annotations_valid_strokes
    check (public.is_valid_question_annotation_strokes(strokes))
);

alter table public.question_annotations enable row level security;

alter table public.question_annotations force row level security;

drop policy if exists question_annotations_select_own on public.question_annotations;

create policy question_annotations_select_own
on public.question_annotations
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists question_annotations_insert_own on public.question_annotations;

create policy question_annotations_insert_own
on public.question_annotations
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists question_annotations_update_own on public.question_annotations;

create policy question_annotations_update_own
on public.question_annotations
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists question_annotations_delete_own on public.question_annotations;

create policy question_annotations_delete_own
on public.question_annotations
for delete
to authenticated
using (auth.uid() = user_id);

revoke all on table public.question_annotations from public, anon;

grant select, insert, update, delete on table public.question_annotations to authenticated;

grant execute on function public.is_valid_question_annotation_strokes(jsonb) to authenticated, service_role;

create or replace function public.touch_question_annotation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.version := 1;
  else
    new.version := old.version + 1;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_touch_question_annotation on public.question_annotations;

create trigger trg_touch_question_annotation
before insert or update on public.question_annotations
for each row execute function public.touch_question_annotation();

create or replace function public.get_my_question_annotations(p_question_id bigint)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'surface', qa.surface,
        'content_hash', qa.content_hash,
        'strokes', qa.strokes,
        'version', qa.version,
        'updated_at', qa.updated_at
      )
      order by qa.surface
    ),
    '[]'::jsonb
  )
  from public.question_annotations qa
  where qa.user_id = auth.uid()
    and qa.question_id = p_question_id;
$$;

create or replace function public.save_my_question_annotation(
  p_question_id bigint,
  p_surface text,
  p_content_hash text,
  p_strokes jsonb,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_current_version integer;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  if p_question_id is null or p_question_id <= 0 then
    raise exception 'invalid_question_id' using errcode = '22023';
  end if;

  if p_surface not in ('stem', 'options', 'explanation') then
    raise exception 'invalid_annotation_surface' using errcode = '22023';
  end if;

  if p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_annotation_content_hash' using errcode = '22023';
  end if;

  if not public.is_valid_question_annotation_strokes(p_strokes) then
    raise exception 'invalid_annotation_payload' using errcode = '22023';
  end if;

  select qa.version
    into v_current_version
  from public.question_annotations qa
  where qa.user_id = v_uid
    and qa.question_id = p_question_id
    and qa.surface = p_surface
  for update;

  if found then
    if p_expected_version is not null and p_expected_version <> v_current_version then
      raise exception 'annotation_conflict' using errcode = '40001';
    end if;

    update public.question_annotations qa
    set content_hash = p_content_hash,
        strokes = p_strokes
    where qa.user_id = v_uid
      and qa.question_id = p_question_id
      and qa.surface = p_surface;
  else
    if p_expected_version is not null and p_expected_version <> 0 then
      raise exception 'annotation_conflict' using errcode = '40001';
    end if;

    begin
      insert into public.question_annotations (
        user_id,
        question_id,
        surface,
        content_hash,
        strokes
      ) values (
        v_uid,
        p_question_id,
        p_surface,
        p_content_hash,
        p_strokes
      );
    exception
      when unique_violation then
        raise exception 'annotation_conflict' using errcode = '40001';
    end;
  end if;

  select jsonb_build_object(
    'surface', qa.surface,
    'content_hash', qa.content_hash,
    'strokes', qa.strokes,
    'version', qa.version,
    'updated_at', qa.updated_at
  )
    into v_result
  from public.question_annotations qa
  where qa.user_id = v_uid
    and qa.question_id = p_question_id
    and qa.surface = p_surface;

  return v_result;
end;
$$;

create or replace function public.clear_my_question_annotations(p_question_id bigint)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  delete from public.question_annotations qa
  where qa.user_id = v_uid
    and qa.question_id = p_question_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.get_my_question_annotations(bigint) from public, anon;

revoke all on function public.save_my_question_annotation(bigint, text, text, jsonb, integer) from public, anon;

revoke all on function public.clear_my_question_annotations(bigint) from public, anon;

grant execute on function public.get_my_question_annotations(bigint) to authenticated, service_role;

grant execute on function public.save_my_question_annotation(bigint, text, text, jsonb, integer) to authenticated, service_role;

grant execute on function public.clear_my_question_annotations(bigint) to authenticated, service_role;

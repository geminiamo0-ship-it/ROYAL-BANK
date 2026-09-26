begin;

create or replace function public.suspend_exam_session_compat(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_completed boolean;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'Active authentication required' using errcode = '42501';
  end if;

  select ts.is_completed
  into v_completed
  from public.test_sessions ts
  where ts.id = p_session_id
    and ts.user_id = auth.uid();

  if not found then
    raise exception 'Session not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'ok', true,
    'session_id', p_session_id,
    'completed', coalesce(v_completed, false),
    'suspended', not coalesce(v_completed, false),
    'compatibility_mode', true
  );
end;
$$;

create or replace function public.resume_exam_session_compat(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_completed boolean;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'Active authentication required' using errcode = '42501';
  end if;

  select ts.is_completed
  into v_completed
  from public.test_sessions ts
  where ts.id = p_session_id
    and ts.user_id = auth.uid();

  if not found then
    raise exception 'Session not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'ok', true,
    'session_id', p_session_id,
    'completed', coalesce(v_completed, false),
    'suspended', false,
    'compatibility_mode', true
  );
end;
$$;

revoke all on function public.suspend_exam_session_compat(uuid) from public, anon;
revoke all on function public.resume_exam_session_compat(uuid) from public, anon;
grant execute on function public.suspend_exam_session_compat(uuid) to authenticated, service_role;
grant execute on function public.resume_exam_session_compat(uuid) to authenticated, service_role;

commit;

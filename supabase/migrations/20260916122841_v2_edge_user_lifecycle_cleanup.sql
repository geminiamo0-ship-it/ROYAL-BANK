create or replace function public.drop_orphan_edge_sync_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_user uuid;
begin
  if new.user_id is null or new.user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return null;
  end if;
  v_user := new.user_id::uuid;
  if not exists (select 1 from public.profiles p where p.id=v_user) then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function public.drop_orphan_edge_sync_event() from public,anon,authenticated;
grant execute on function public.drop_orphan_edge_sync_event() to service_role;

drop trigger if exists edge_sync_drop_orphan_event on public.edge_exam_sync_inbox;
create trigger edge_sync_drop_orphan_event
before insert on public.edge_exam_sync_inbox
for each row execute function public.drop_orphan_edge_sync_event();

create or replace function public.cleanup_edge_sync_inbox_for_deleted_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  delete from public.edge_exam_sync_inbox where user_id=old.id::text;
  return old;
end;
$$;

revoke all on function public.cleanup_edge_sync_inbox_for_deleted_profile() from public,anon,authenticated;

drop trigger if exists cleanup_edge_sync_inbox_on_profile_delete on public.profiles;
create trigger cleanup_edge_sync_inbox_on_profile_delete
after delete on public.profiles
for each row execute function public.cleanup_edge_sync_inbox_for_deleted_profile();

do $$
begin
  if not exists (select 1 from pg_constraint where conname='edge_exam_sessions_user_profile_fkey') then
    alter table public.edge_exam_sessions
      add constraint edge_exam_sessions_user_profile_fkey foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='edge_exam_session_questions_user_profile_fkey') then
    alter table public.edge_exam_session_questions
      add constraint edge_exam_session_questions_user_profile_fkey foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='edge_exam_answers_user_profile_fkey') then
    alter table public.edge_exam_answers
      add constraint edge_exam_answers_user_profile_fkey foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='edge_exam_flags_user_profile_fkey') then
    alter table public.edge_exam_flags
      add constraint edge_exam_flags_user_profile_fkey foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='edge_user_question_state_user_profile_fkey') then
    alter table public.edge_user_question_state
      add constraint edge_user_question_state_user_profile_fkey foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='edge_user_bank_daily_user_profile_fkey') then
    alter table public.edge_user_bank_daily
      add constraint edge_user_bank_daily_user_profile_fkey foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
end;
$$;

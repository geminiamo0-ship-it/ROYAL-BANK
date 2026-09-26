begin;

alter table public.ai_deep_dive_config
  drop constraint if exists ai_deep_dive_config_timeout_ms_check;

alter table public.ai_deep_dive_config
  add constraint ai_deep_dive_config_timeout_ms_check
  check (timeout_ms >= 5000 and timeout_ms <= 170000);

create or replace function public.admin_update_deep_dive_ai_config_session(
  p_primary_model text,
  p_fallback_model text,
  p_temperature numeric,
  p_max_initial_tokens integer,
  p_max_followup_tokens integer,
  p_timeout_ms integer,
  p_default_daily_limit integer,
  p_default_followup_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_updated_at timestamptz := now();
  v_rows integer;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and p.role = 'admin'
  ) then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;

  if p_temperature < 0 or p_temperature > 1
     or p_max_initial_tokens not between 300 and 4000
     or p_max_followup_tokens not between 200 and 2500
     or p_timeout_ms not between 5000 and 170000
     or p_default_daily_limit not between 1 and 100
     or p_default_followup_limit not between 1 and 100
     or length(trim(p_primary_model)) < 3 then
    raise exception 'Invalid Deep Dive configuration.' using errcode = '22023';
  end if;

  update public.ai_deep_dive_config
  set primary_model = trim(p_primary_model),
      fallback_model = nullif(trim(coalesce(p_fallback_model, '')), ''),
      temperature = p_temperature,
      max_initial_tokens = p_max_initial_tokens,
      max_followup_tokens = p_max_followup_tokens,
      timeout_ms = p_timeout_ms,
      default_daily_limit = p_default_daily_limit,
      default_followup_limit = p_default_followup_limit,
      updated_at = v_updated_at
  where active = true;

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Active Deep Dive configuration was not found.' using errcode = 'P0001';
  end if;

  return jsonb_build_object('updated_at', v_updated_at);
end;
$$;

update public.ai_deep_dive_config
set timeout_ms = 170000,
    updated_at = now()
where active = true;

commit;

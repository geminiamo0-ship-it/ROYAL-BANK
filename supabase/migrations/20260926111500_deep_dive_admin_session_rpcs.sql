begin;

create or replace function public.admin_get_deep_dive_ai_overview_session(
  p_from timestamptz default (now() - interval '30 days')
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_result jsonb;
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

  with filtered as (
    select *
    from public.ai_usage_events
    where occurred_at >= greatest(p_from, now() - interval '90 days')
  ),
  starts as (
    select *
    from filtered
    where event_type = 'ai.deep_dive.started'
  ),
  model_usage as (
    select
      coalesce(model, 'unknown') as model,
      count(*)::bigint as requests,
      coalesce(sum(input_tokens), 0)::bigint as input_tokens,
      coalesce(sum(output_tokens), 0)::bigint as output_tokens,
      coalesce(sum(cost_usd), 0)::numeric as cost_usd
    from filtered
    group by coalesce(model, 'unknown')
  )
  select jsonb_build_object(
    'from', greatest(p_from, now() - interval '90 days'),
    'to', now(),
    'config', coalesce((
      select jsonb_build_object(
        'primary_model', c.primary_model,
        'fallback_model', c.fallback_model,
        'temperature', c.temperature,
        'max_initial_tokens', c.max_initial_tokens,
        'max_followup_tokens', c.max_followup_tokens,
        'prompt_version', c.prompt_version,
        'timeout_ms', c.timeout_ms,
        'default_daily_limit', c.default_daily_limit,
        'default_followup_limit', c.default_followup_limit,
        'updated_at', c.updated_at
      )
      from public.ai_deep_dive_config c
      where c.active = true
      order by c.updated_at desc
      limit 1
    ), '{}'::jsonb),
    'usage', jsonb_build_object(
      'requests', (select count(*) from filtered),
      'deep_dive_starts', (select count(*) from starts),
      'followup_messages', (select count(*) from filtered where event_type = 'ai.deep_dive.message'),
      'active_users', (select count(distinct user_id) from filtered),
      'cache_hits', (select count(*) from starts where cache_hit = true),
      'cache_hit_rate_percent', coalesce((
        select round(100.0 * count(*) filter (where cache_hit = true) / nullif(count(*), 0), 2)
        from starts
      ), 0),
      'input_tokens', coalesce((select sum(input_tokens) from filtered), 0),
      'output_tokens', coalesce((select sum(output_tokens) from filtered), 0),
      'cost_usd', coalesce((select sum(cost_usd) from filtered), 0),
      'avg_latency_ms', coalesce((select round(avg(latency_ms), 1) from filtered), 0)
    ),
    'models', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'model', m.model,
          'requests', m.requests,
          'input_tokens', m.input_tokens,
          'output_tokens', m.output_tokens,
          'cost_usd', m.cost_usd
        )
        order by m.requests desc, m.model
      )
      from model_usage m
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

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
     or p_timeout_ms not between 5000 and 55000
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

create or replace function public.support_resolve_deep_dive_user(
  p_identifier text
)
returns table (
  id uuid,
  email text,
  full_name text
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_identifier text := trim(coalesce(p_identifier, ''));
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and p.role in ('admin', 'support')
  ) then
    raise exception 'Support access is required.' using errcode = '42501';
  end if;

  if length(v_identifier) < 3 or length(v_identifier) > 200 then
    raise exception 'Enter a valid account email or user ID.' using errcode = '22023';
  end if;

  if v_identifier ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return query
      select p.id, p.email, p.full_name
      from public.profiles p
      where p.id = v_identifier::uuid
      limit 1;
  else
    return query
      select p.id, p.email, p.full_name
      from public.profiles p
      where lower(p.email) = lower(v_identifier)
      limit 1;
  end if;
end;
$$;

revoke all on function public.admin_get_deep_dive_ai_overview_session(timestamptz) from public, anon;
revoke all on function public.admin_update_deep_dive_ai_config_session(text,text,numeric,integer,integer,integer,integer,integer) from public, anon;
revoke all on function public.support_resolve_deep_dive_user(text) from public, anon;

grant execute on function public.admin_get_deep_dive_ai_overview_session(timestamptz) to authenticated, service_role;
grant execute on function public.admin_update_deep_dive_ai_config_session(text,text,numeric,integer,integer,integer,integer,integer) to authenticated, service_role;
grant execute on function public.support_resolve_deep_dive_user(text) to authenticated, service_role;

commit;

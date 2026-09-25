begin;

create or replace function public.admin_get_deep_dive_ai_overview(
  p_from timestamptz default (now() - interval '30 days')
)
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $$
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
  );
$$;

revoke all on function public.admin_get_deep_dive_ai_overview(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_get_deep_dive_ai_overview(timestamptz) to service_role;

commit;

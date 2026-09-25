begin;

update public.ai_deep_dive_config
set
  fallback_model = 'deepseek/deepseek-v4-pro-0813',
  updated_at = now()
where active = true
  and (fallback_model is null or btrim(fallback_model) = '');

commit;

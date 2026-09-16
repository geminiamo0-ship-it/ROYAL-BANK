-- Read-only preflight for the Cloudflare exam cutover.
-- Intended for ROYAL-BANK Production before any edge migration is applied.
-- This script MUST NOT mutate the database.

with required_relations(name) as (
  values
    ('profiles'),
    ('question_banks'),
    ('question_bank_questions'),
    ('questions'),
    ('options'),
    ('test_sessions'),
    ('test_session_questions'),
    ('user_answers'),
    ('user_question_flags'),
    ('question_bank_dashboard_cache'),
    ('question_bank_performance_cache')
),
required_functions(name) as (
  values
    ('public.is_active_user()'),
    ('public.can_access_question_bank(bigint)'),
    ('public.mark_question_bank_dashboard_dirty(uuid,bigint)'),
    ('public.compute_question_bank_performance(bigint)'),
    ('public.get_question_bank_performance(bigint)')
),
edge_names(name) as (
  values
    ('edge_exam_sync_inbox'),
    ('edge_exam_sessions'),
    ('edge_exam_session_questions'),
    ('edge_exam_answers'),
    ('edge_exam_flags'),
    ('edge_user_question_state'),
    ('edge_user_bank_daily')
),
relation_checks as (
  select name, to_regclass('public.' || name) is not null as present
  from required_relations
),
function_checks as (
  select name, to_regprocedure(name) is not null as present
  from required_functions
),
edge_collision_checks as (
  select name, to_regclass('public.' || name) is null as name_free
  from edge_names
),
profile_integrity as (
  select
    count(*)::bigint as auth_users_total,
    count(*) filter (where p.id is null)::bigint as auth_users_missing_profiles
  from auth.users u
  left join public.profiles p on p.id = u.id
),
function_acl as (
  select
    has_function_privilege('anon', 'public.can_access_question_bank(bigint)', 'EXECUTE') as anon_can_access_exec,
    has_function_privilege('authenticated', 'public.can_access_question_bank(bigint)', 'EXECUTE') as authenticated_can_access_exec,
    has_function_privilege('anon', 'public.get_question_bank_performance(bigint)', 'EXECUTE') as anon_performance_exec,
    has_function_privilege('authenticated', 'public.get_question_bank_performance(bigint)', 'EXECUTE') as authenticated_performance_exec,
    has_function_privilege('authenticated', 'public.mark_question_bank_dashboard_dirty(uuid,bigint)', 'EXECUTE') as authenticated_mark_dirty_exec,
    has_function_privilege('authenticated', 'public.compute_question_bank_performance(bigint)', 'EXECUTE') as authenticated_compute_exec
)
select jsonb_build_object(
  'ready',
    not exists (select 1 from relation_checks where not present)
    and not exists (select 1 from function_checks where not present)
    and not exists (select 1 from edge_collision_checks where not name_free)
    and (select auth_users_missing_profiles = 0 from profile_integrity)
    and not (select anon_can_access_exec from function_acl)
    and (select authenticated_can_access_exec from function_acl)
    and not (select anon_performance_exec from function_acl)
    and (select authenticated_performance_exec from function_acl)
    and not (select authenticated_mark_dirty_exec from function_acl)
    and not (select authenticated_compute_exec from function_acl),
  'relations', (select jsonb_object_agg(name, present) from relation_checks),
  'functions', (select jsonb_object_agg(name, present) from function_checks),
  'edge_names_free', (select jsonb_object_agg(name, name_free) from edge_collision_checks),
  'profiles', (select to_jsonb(profile_integrity) from profile_integrity),
  'acl', (select to_jsonb(function_acl) from function_acl),
  'function_hashes', jsonb_build_object(
    'can_access_question_bank', md5(pg_get_functiondef('public.can_access_question_bank(bigint)'::regprocedure)),
    'is_active_user', md5(pg_get_functiondef('public.is_active_user()'::regprocedure)),
    'mark_question_bank_dashboard_dirty', md5(pg_get_functiondef('public.mark_question_bank_dashboard_dirty(uuid,bigint)'::regprocedure)),
    'compute_question_bank_performance', md5(pg_get_functiondef('public.compute_question_bank_performance(bigint)'::regprocedure)),
    'get_question_bank_performance', md5(pg_get_functiondef('public.get_question_bank_performance(bigint)'::regprocedure))
  )
) as production_edge_preflight;

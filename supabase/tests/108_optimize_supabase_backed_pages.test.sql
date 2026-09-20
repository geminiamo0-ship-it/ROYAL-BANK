BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(8);

SELECT extensions.ok(
  to_regprocedure('public.get_library_catalog_access_state(bigint)') IS NOT NULL,
  'library catalog access-state RPC exists'
);
SELECT extensions.ok(
  to_regprocedure('public.get_study_plan_dashboard_light(bigint)') IS NOT NULL,
  'light Study Plan dashboard RPC exists'
);
SELECT extensions.ok(
  has_function_privilege('authenticated','public.get_library_catalog_access_state(bigint)','EXECUTE'),
  'authenticated may read compact library access state'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon','public.get_library_catalog_access_state(bigint)','EXECUTE'),
  'anon cannot read compact library access state'
);
SELECT extensions.ok(
  has_function_privilege('authenticated','public.get_study_plan_dashboard_light(bigint)','EXECUTE'),
  'authenticated may read light Study Plan dashboard'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon','public.get_study_plan_dashboard_light(bigint)','EXECUTE'),
  'anon cannot read light Study Plan dashboard'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','',true);

SELECT extensions.throws_ok(
  $$SELECT public.get_library_catalog_access_state(1)$$,
  'ACTIVE_AUTHENTICATION_REQUIRED',
  'library access state rejects missing authenticated uid'
);
SELECT extensions.throws_ok(
  $$SELECT public.get_study_plan_dashboard_light(1)$$,
  'Authentication required',
  'Study Plan light read rejects missing authenticated uid'
);

SELECT * FROM extensions.finish();
ROLLBACK;

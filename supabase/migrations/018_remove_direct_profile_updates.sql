-- All profile mutations now go through controlled RPCs:
--   update_my_profile() for the current user's safe fields
--   admin_update_user_access() for privileged fields
-- Remove direct UPDATE policies entirely so column privilege cannot be bypassed
-- through the generic PostgREST table endpoint.

DROP POLICY IF EXISTS "Admins can update profiles" ON public.profiles;

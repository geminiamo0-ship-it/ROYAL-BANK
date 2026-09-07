-- X-audit hardening for client-controlled write surfaces.
--
-- 1. profiles: the old self-update RLS policy restricted rows, not columns. Because
--    authenticated had table UPDATE, an owner could attempt to mutate privileged
--    columns such as role/subscription_tier/is_active directly. All legitimate user
--    profile edits already have the narrow update_my_profile() SECURITY DEFINER RPC;
--    staff privilege changes use admin_update_user_access().
--
-- 2. user_question_flags: direct INSERT/DELETE could bypass the new disclosure gate
--    in set_question_flag(). Route all flag mutations through that RPC instead.

DROP POLICY IF EXISTS "Users can update own profile (restricted) or admin full update"
    ON public.profiles;

REVOKE INSERT, UPDATE, DELETE
    ON TABLE public.profiles
    FROM anon, authenticated;

DROP POLICY IF EXISTS "Active users insert own accessible flags"
    ON public.user_question_flags;
DROP POLICY IF EXISTS "Active users delete own accessible flags"
    ON public.user_question_flags;

REVOKE INSERT, UPDATE, DELETE
    ON TABLE public.user_question_flags
    FROM anon, authenticated;

-- create_exam_session may run as a SECURITY DEFINER function while auth.uid() still
-- identifies the caller. The quota guard binds NEW.user_id to that caller and does
-- not depend on a direct table INSERT policy.

COMMENT ON FUNCTION public.enforce_free_trial_session_quota() IS
'Guards trusted session creation; requires NEW.user_id = auth.uid(), active account, bank access and remaining trial quota.';

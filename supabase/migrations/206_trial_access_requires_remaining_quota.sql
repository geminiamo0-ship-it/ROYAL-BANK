-- Existing trial users may still read a previously created trial session after
-- exhausting quota; quota only controls creation of additional blocks. Therefore
-- can_access_question_bank intentionally does not check remaining quota.
COMMENT ON FUNCTION public.can_access_question_bank(BIGINT) IS
'Content access check. Trial quota exhaustion blocks NEW session creation but does not revoke access to existing trial-bank content/session review.';

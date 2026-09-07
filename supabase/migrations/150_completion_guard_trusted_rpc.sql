-- The completion RPC performs the authoritative score calculation. The trigger
-- validates immutability but permits the transition from active -> completed.

COMMENT ON FUNCTION public.complete_exam_session(UUID) IS
'Authoritative End Block operation: computes score from persisted answers and finalizes the session.';

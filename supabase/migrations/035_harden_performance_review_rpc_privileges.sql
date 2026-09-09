-- Supabase project default privileges grant EXECUTE to anon/authenticated/service_role
-- on newly created functions. These user-specific analytics/review RPCs are intended
-- for authenticated users only, so revoke anon explicitly as well as PUBLIC.

REVOKE EXECUTE ON FUNCTION public.get_question_bank_performance(BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_question_bank_performance(BIGINT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_bank_sessions(BIGINT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_bank_sessions(BIGINT, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_completed_exam_review_bootstrap(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_completed_exam_review_bootstrap(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_completed_exam_review_window(UUID, INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_completed_exam_review_window(UUID, INTEGER, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_completed_exam_review_feedback(UUID, BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_completed_exam_review_feedback(UUID, BIGINT) FROM anon;

GRANT EXECUTE ON FUNCTION public.get_question_bank_performance(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_bank_sessions(BIGINT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_completed_exam_review_bootstrap(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_completed_exam_review_window(UUID, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_completed_exam_review_feedback(UUID, BIGINT) TO authenticated;

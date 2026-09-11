-- Remove exact duplicate indexes after checking live definitions and usage counters.
-- Keep the heavily used / canonical copy in each group.

DROP INDEX IF EXISTS public.idx_qbank_q_bank_id;
DROP INDEX IF EXISTS public.idx_tsq_question;
DROP INDEX IF EXISTS public.idx_tsq_session_sort;
DROP INDEX IF EXISTS public.idx_user_answers_user_id_q_id;

ALTER TABLE public.test_session_questions
    DROP CONSTRAINT IF EXISTS test_session_questions_test_session_id_question_id_key;

-- Cache invalidation by bank should not scan every user's cache row as adoption grows.
CREATE INDEX IF NOT EXISTS idx_question_bank_performance_cache_bank
    ON public.question_bank_performance_cache(question_bank_id);
CREATE INDEX IF NOT EXISTS idx_question_bank_dashboard_cache_bank
    ON public.question_bank_dashboard_cache(question_bank_id);

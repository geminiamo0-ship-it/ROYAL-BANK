-- Keep refresh explicit/batched for ingestion performance rather than refreshing a
-- materialized view on every inserted question mapping.
COMMENT ON TABLE public.question_bank_questions IS
'After bulk mapping changes, call admin-only refresh_question_bank_counts() once to refresh shared category/topic counts.';

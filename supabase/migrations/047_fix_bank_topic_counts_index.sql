DROP INDEX IF EXISTS public.idx_mv_topic_counts;

CREATE UNIQUE INDEX idx_mv_topic_counts
ON public.question_bank_topic_counts(
    question_bank_id,
    category,
    (COALESCE(topic, ''))
);

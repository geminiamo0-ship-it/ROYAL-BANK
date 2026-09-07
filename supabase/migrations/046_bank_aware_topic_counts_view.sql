-- Replace the legacy Bank-1-only materialized view with counts for every mapped bank.

DROP MATERIALIZED VIEW IF EXISTS public.question_bank_topic_counts CASCADE;

CREATE MATERIALIZED VIEW public.question_bank_topic_counts AS
SELECT
    qbq.question_bank_id,
    q.category,
    q.topic,
    COUNT(*) AS total_questions
FROM public.question_bank_questions qbq
JOIN public.questions q ON q.id = qbq.question_id
WHERE q.category IS NOT NULL
GROUP BY qbq.question_bank_id, q.category, q.topic;

CREATE UNIQUE INDEX idx_mv_topic_counts
ON public.question_bank_topic_counts(question_bank_id, category, COALESCE(topic, ''));

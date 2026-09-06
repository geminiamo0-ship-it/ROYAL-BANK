-- 1. Create B-Tree Indexes for tables available at this point in the chain.

CREATE INDEX IF NOT EXISTS idx_questions_category_difficulty_id
ON public.questions(category, difficulty, id);

CREATE INDEX IF NOT EXISTS idx_questions_category_topic_difficulty_id
ON public.questions(category, topic, difficulty, id);

CREATE INDEX IF NOT EXISTS idx_options_question_order
ON public.options(question_id, option_order);

-- public.test_session_questions is not created until migration 032.
-- Migration 032 creates the canonical (test_session_id, sort_order) index.

CREATE INDEX IF NOT EXISTS idx_test_sessions_user_active
ON public.test_sessions(user_id, is_completed, id);

CREATE INDEX IF NOT EXISTS idx_user_answers_user_question
ON public.user_answers(user_id, question_id);

-- 2. Create Partial Indexes.
CREATE INDEX IF NOT EXISTS idx_user_answers_incorrect
ON public.user_answers(user_id, question_id)
WHERE is_correct = false;

CREATE INDEX IF NOT EXISTS idx_user_answers_flagged
ON public.user_answers(user_id, question_id)
WHERE is_flagged = true;

-- 3. Legacy materialized view. Later migrations replace its Bank-1-only semantics
-- with bank-aware counting, but keeping this migration replayable preserves history.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.question_bank_topic_counts AS
SELECT
  1::bigint AS question_bank_id,
  category,
  topic,
  COUNT(*) AS total_questions
FROM public.questions
WHERE category IS NOT NULL
GROUP BY category, topic;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_topic_counts
ON public.question_bank_topic_counts(category, topic);

-- 4. Create an RPC to refresh the materialized view.
CREATE OR REPLACE FUNCTION refresh_question_bank_counts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.question_bank_topic_counts;
END;
$$;

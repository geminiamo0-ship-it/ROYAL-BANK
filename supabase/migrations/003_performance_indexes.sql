-- Migration: Performance Indexes and Category RPC
-- Description: Adds indexes to tables that exist at this point in the migration chain.
-- test_session_questions is created later in 032, which owns its ordering index.

-- 1. Create RPC for category and topic counts
CREATE OR REPLACE FUNCTION get_category_topic_counts(p_bank_id INT)
RETURNS TABLE (
  category TEXT,
  topic TEXT,
  total_questions BIGINT
) AS $$
BEGIN
  IF p_bank_id = 1 THEN
    -- Legacy Bank 1 behavior; superseded by later bank-aware RPC migrations.
    RETURN QUERY
    SELECT q.category, q.topic, COUNT(*) as total_questions
    FROM questions q
    WHERE q.category IS NOT NULL
    GROUP BY q.category, q.topic;
  ELSE
    RETURN QUERY
    SELECT q.category, q.topic, COUNT(*) as total_questions
    FROM question_bank_questions qbq
    JOIN questions q ON q.id = qbq.question_id
    WHERE qbq.question_bank_id = p_bank_id
      AND q.category IS NOT NULL
    GROUP BY q.category, q.topic;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create indexes for tables already created by 001.
CREATE INDEX IF NOT EXISTS idx_questions_category ON public.questions(category);
CREATE INDEX IF NOT EXISTS idx_questions_topic ON public.questions(topic);
CREATE INDEX IF NOT EXISTS idx_questions_difficulty ON public.questions(difficulty);

CREATE INDEX IF NOT EXISTS idx_qbank_q_bank_id
    ON public.question_bank_questions(question_bank_id, question_id);

CREATE INDEX IF NOT EXISTS idx_user_answers_user_id_q_id
    ON public.user_answers(user_id, question_id);
CREATE INDEX IF NOT EXISTS idx_user_answers_user_is_correct
    ON public.user_answers(user_id, is_correct);
CREATE INDEX IF NOT EXISTS idx_user_answers_user_is_flagged
    ON public.user_answers(user_id, is_flagged);

-- Do not create an index on public.test_session_questions here: that table does
-- not exist until migration 032. Migration 032 creates
-- idx_test_session_questions_session_sort after the table is created.

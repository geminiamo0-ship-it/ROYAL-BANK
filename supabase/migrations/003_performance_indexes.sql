-- Migration: Performance Indexes and Category RPC
-- Description: Adds indexes to heavily queried columns and creates an RPC to group category counts

-- 1. Create RPC for category and topic counts
CREATE OR REPLACE FUNCTION get_category_topic_counts(p_bank_id INT)
RETURNS TABLE (
  category TEXT,
  topic TEXT,
  total_questions BIGINT
) AS $$
BEGIN
  IF p_bank_id = 1 THEN
    -- Raw questions (Bank 1 is usually the master bank or raw fetch)
    RETURN QUERY
    SELECT q.category, q.topic, COUNT(*) as total_questions
    FROM questions q
    WHERE q.category IS NOT NULL
    GROUP BY q.category, q.topic;
  ELSE
    -- Bank-specific questions mapped via question_bank_questions
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

-- 2. Create Composite and Single Indexes
-- (IF NOT EXISTS is used to prevent errors if they already exist)

-- Questions table indexes
CREATE INDEX IF NOT EXISTS idx_questions_category ON public.questions(category);
CREATE INDEX IF NOT EXISTS idx_questions_topic ON public.questions(topic);
CREATE INDEX IF NOT EXISTS idx_questions_difficulty ON public.questions(difficulty);

-- Question Bank mappings index
CREATE INDEX IF NOT EXISTS idx_qbank_q_bank_id ON public.question_bank_questions(question_bank_id, question_id);

-- User Answers composite indexes (essential for filtering 'new', 'incorrect', 'flagged')
CREATE INDEX IF NOT EXISTS idx_user_answers_user_id_q_id ON public.user_answers(user_id, question_id);
CREATE INDEX IF NOT EXISTS idx_user_answers_user_is_correct ON public.user_answers(user_id, is_correct);
CREATE INDEX IF NOT EXISTS idx_user_answers_user_is_flagged ON public.user_answers(user_id, is_flagged);

-- Test Session Questions index (essential for ordering exam blocks)
CREATE INDEX IF NOT EXISTS idx_tsq_session_sort ON public.test_session_questions(test_session_id, sort_order);

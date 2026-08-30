-- 1. Create B-Tree Indexes for heavily queried columns to speed up sorting and filtering

-- Speeds up fetching questions based on their category and difficulty
CREATE INDEX IF NOT EXISTS idx_questions_category_difficulty_id 
ON public.questions(category, difficulty, id);

-- Speeds up fetching questions when the user drills down into a specific topic
CREATE INDEX IF NOT EXISTS idx_questions_category_topic_difficulty_id 
ON public.questions(category, topic, difficulty, id);

-- Speeds up fetching options for a specific question in the correct order
CREATE INDEX IF NOT EXISTS idx_options_question_order 
ON public.options(question_id, option_order);

-- Speeds up loading an active exam session in the correct sequence
CREATE INDEX IF NOT EXISTS idx_tsq_session_sort 
ON public.test_session_questions(test_session_id, sort_order);

-- Speeds up finding previous active sessions for a user
CREATE INDEX IF NOT EXISTS idx_test_sessions_user_active 
ON public.test_sessions(user_id, is_completed, id);

-- Speeds up checking if a user has answered a specific question
CREATE INDEX IF NOT EXISTS idx_user_answers_user_question 
ON public.user_answers(user_id, question_id);


-- 2. Create Partial Indexes (Highly Optimized)
-- These only index rows that match the WHERE clause. 
-- They are extremely small and lightning-fast.

-- Instantly find all questions a user got wrong (Used for "Incorrect Only" exam mode)
CREATE INDEX IF NOT EXISTS idx_user_answers_incorrect 
ON public.user_answers(user_id, question_id) 
WHERE is_correct = false;

-- Instantly find all questions a user flagged (Used for "Flagged Only" exam mode)
CREATE INDEX IF NOT EXISTS idx_user_answers_flagged 
ON public.user_answers(user_id, question_id) 
WHERE is_flagged = true;


-- 3. Create a Materialized View for Question Bank Statistics
-- A materialized view physically stores the result of the query on the disk,
-- so we don't have to count thousands of rows every time a user visits the page.

CREATE MATERIALIZED VIEW IF NOT EXISTS public.question_bank_topic_counts AS
SELECT 
  1::bigint AS question_bank_id, 
  category, 
  topic, 
  COUNT(*) AS total_questions
FROM public.questions
WHERE category IS NOT NULL
GROUP BY category, topic;

-- Index the materialized view so fetching specific categories from it is instant
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_topic_counts 
ON public.question_bank_topic_counts(category, topic);


-- 4. Create an RPC to safely refresh the materialized view
-- You should call this RPC from your admin panel whenever you import new questions.
CREATE OR REPLACE FUNCTION refresh_question_bank_counts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.question_bank_topic_counts;
END;
$$;

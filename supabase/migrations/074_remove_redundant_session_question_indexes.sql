-- Reduce write amplification on public.test_session_questions.
--
-- Create inserts up to 70 session-question rows in one statement. Two single-column
-- indexes duplicate the left-most prefixes of hotter composite indexes:
--
--   idx_test_session_questions_session(test_session_id)
--     -> covered by idx_test_session_questions_session_sort(test_session_id, sort_order)
--
--   idx_test_session_questions_question(question_id)
--     -> covered by idx_tsq_question_session(question_id, test_session_id)
--
-- Production planner checks use the composite indexes for representative session and
-- question lookups. Neither single-column index backs a PK/UNIQUE constraint. Removing
-- them avoids two index updates for every inserted session-question row.

DROP INDEX IF EXISTS public.idx_test_session_questions_session;
DROP INDEX IF EXISTS public.idx_test_session_questions_question;

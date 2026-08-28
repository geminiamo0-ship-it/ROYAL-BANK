-- Migration: Fix RPC 1000-row limit for counts
-- Description: Changes the RPC to return a JSON payload to bypass PostgREST's 1000-row limit

CREATE OR REPLACE FUNCTION get_category_topic_counts_json(p_bank_id INT)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  IF p_bank_id = 1 THEN
    SELECT json_agg(row_to_json(t)) INTO result
    FROM (
      SELECT q.category, q.topic, COUNT(*) as total_questions
      FROM questions q
      WHERE q.category IS NOT NULL
      GROUP BY q.category, q.topic
    ) t;
  ELSE
    SELECT json_agg(row_to_json(t)) INTO result
    FROM (
      SELECT q.category, q.topic, COUNT(*) as total_questions
      FROM question_bank_questions qbq
      JOIN questions q ON q.id = qbq.question_id
      WHERE qbq.question_bank_id = p_bank_id
        AND q.category IS NOT NULL
      GROUP BY q.category, q.topic
    ) t;
  END IF;
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Cover the question_id foreign key introduced by exam answer idempotency.
-- This keeps FK maintenance and question-scoped cleanup from requiring a table scan.

CREATE INDEX IF NOT EXISTS exam_answer_idempotency_question_idx
    ON private.exam_answer_idempotency (question_id);

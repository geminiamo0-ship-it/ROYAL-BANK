-- Precomputed question-bank dashboard for low-latency category/topic state reads.
-- Static bank totals are materialized in a small table. Per-user dashboard payloads
-- are cached and invalidated cheaply by state-changing triggers.

CREATE TABLE IF NOT EXISTS public.bank_question_stats (
    question_bank_id BIGINT NOT NULL REFERENCES public.question_banks(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    topic TEXT,
    difficulty TEXT NOT NULL CHECK (difficulty IN ('1', '2', '3')),
    total_questions INTEGER NOT NULL CHECK (total_questions >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (question_bank_id, category, difficulty, topic)
);

-- Flagged is a persistent user-question property, independent of an individual
-- answer/session. It remains until the user explicitly unflags the question.

CREATE TABLE IF NOT EXISTS public.user_question_flags (
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    question_id BIGINT NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    flagged_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (user_id, question_id)
);

ALTER TABLE public.user_question_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own question flags"
    ON public.user_question_flags FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_user_question_flags_question
    ON public.user_question_flags(question_id);

-- Preserve existing flags from historical answer rows.
INSERT INTO public.user_question_flags (user_id, question_id)
SELECT DISTINCT ua.user_id, ua.question_id
FROM public.user_answers ua
WHERE ua.is_flagged = TRUE
ON CONFLICT (user_id, question_id) DO NOTHING;

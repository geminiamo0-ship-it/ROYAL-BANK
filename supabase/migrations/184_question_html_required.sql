ALTER TABLE public.questions
    DROP CONSTRAINT IF EXISTS questions_text_nonempty;
ALTER TABLE public.questions
    ADD CONSTRAINT questions_text_nonempty CHECK (btrim(text_html) <> '');

ALTER TABLE public.questions
    DROP CONSTRAINT IF EXISTS questions_explanation_nonempty;
ALTER TABLE public.questions
    ADD CONSTRAINT questions_explanation_nonempty CHECK (btrim(explanation_html) <> '');

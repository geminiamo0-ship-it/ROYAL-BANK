ALTER TABLE public.options
    DROP CONSTRAINT IF EXISTS options_text_nonempty;
ALTER TABLE public.options
    ADD CONSTRAINT options_text_nonempty CHECK (btrim(text_html) <> '');

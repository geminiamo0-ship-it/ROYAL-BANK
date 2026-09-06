ALTER TABLE public.options
    DROP CONSTRAINT IF EXISTS options_percentage_range;
ALTER TABLE public.options
    ADD CONSTRAINT options_percentage_range
    CHECK (percentage BETWEEN 0 AND 100);

ALTER TABLE public.options
    DROP CONSTRAINT IF EXISTS options_order_nonnegative;
ALTER TABLE public.options
    ADD CONSTRAINT options_order_nonnegative
    CHECK (option_order >= 0);

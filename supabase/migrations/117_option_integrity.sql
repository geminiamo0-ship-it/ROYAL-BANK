-- Normalize legacy option data before enforcing bounds and ordering constraints.
UPDATE public.options
SET percentage = LEAST(100, GREATEST(0, COALESCE(percentage, 0)));

WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY option_order, id) - 1 AS new_order
    FROM public.options
)
UPDATE public.options o
SET option_order = ranked.new_order
FROM ranked
WHERE o.id = ranked.id;

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

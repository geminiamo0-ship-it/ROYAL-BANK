DROP INDEX IF EXISTS public.idx_options_unique_order_per_question;

WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY option_order, id) - 1 AS new_order
    FROM public.options
)
UPDATE public.options o
SET option_order = ranked.new_order
FROM ranked
WHERE o.id = ranked.id;

CREATE UNIQUE INDEX idx_options_unique_order_per_question
ON public.options(question_id, option_order);

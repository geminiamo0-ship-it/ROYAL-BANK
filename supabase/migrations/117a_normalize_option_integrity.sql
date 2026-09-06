-- Runs before 118/119 and keeps option data within supported bounds.
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

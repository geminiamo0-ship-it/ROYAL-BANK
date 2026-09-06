-- If legacy data contains multiple correct options, preserve the earliest ordered
-- correct option and clear the rest before applying the one-correct-option index.
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY option_order, id) AS rn
    FROM public.options
    WHERE is_correct = TRUE
)
UPDATE public.options o
SET is_correct = FALSE
FROM ranked
WHERE o.id = ranked.id
  AND ranked.rn > 1;

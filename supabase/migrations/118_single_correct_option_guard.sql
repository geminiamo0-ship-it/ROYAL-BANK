-- Preserve the earliest ordered correct option if legacy data has duplicates.
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_options_one_correct_per_question
ON public.options(question_id)
WHERE is_correct = TRUE;

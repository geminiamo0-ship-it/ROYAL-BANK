CREATE UNIQUE INDEX IF NOT EXISTS idx_options_unique_order_per_question
ON public.options(question_id, option_order);

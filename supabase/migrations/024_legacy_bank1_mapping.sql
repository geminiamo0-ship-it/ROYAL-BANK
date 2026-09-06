-- Legacy code treated Bank 1 as "all questions" instead of using the mapping
-- table. Normalize that data once so every bank follows the same access/query path.

INSERT INTO public.question_bank_questions (question_bank_id, question_id)
SELECT 1, q.id
FROM public.questions q
WHERE EXISTS (SELECT 1 FROM public.question_banks qb WHERE qb.id = 1)
ON CONFLICT (question_bank_id, question_id) DO NOTHING;

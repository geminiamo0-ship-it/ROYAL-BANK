-- Every bank belongs to a pathway; access policy depends on this relationship.
DELETE FROM public.question_banks qb
WHERE qb.pathway_id IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM public.question_bank_questions qbq
      WHERE qbq.question_bank_id = qb.id
  );

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.question_banks WHERE pathway_id IS NULL) THEN
        RAISE EXCEPTION 'Cannot enforce pathway ownership: mapped question bank has NULL pathway_id';
    END IF;
END;
$$;

ALTER TABLE public.question_banks
    ALTER COLUMN pathway_id SET NOT NULL;

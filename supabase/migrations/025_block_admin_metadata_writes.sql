-- Authorization metadata must be changed through explicit administrative RPCs,
-- not generic table writes. This prevents an accidental client-side admin feature
-- from changing access rules without validation/auditing.

DROP POLICY IF EXISTS "Admins have full access to pathways" ON public.pathways;
DROP POLICY IF EXISTS "Admins have full access to question_banks" ON public.question_banks;
DROP POLICY IF EXISTS "Admins have full access to blocks" ON public.blocks;

DROP POLICY IF EXISTS "Authenticated users can read pathways" ON public.pathways;
CREATE POLICY "Active users can read pathways"
    ON public.pathways FOR SELECT TO authenticated
    USING (public.is_active_user());

DROP POLICY IF EXISTS "Authenticated users can read question bank metadata" ON public.question_banks;
CREATE POLICY "Active users can read question bank metadata"
    ON public.question_banks FOR SELECT TO authenticated
    USING (public.is_active_user());

DROP POLICY IF EXISTS "Authenticated users can read blocks" ON public.blocks;
CREATE POLICY "Active users can read blocks"
    ON public.blocks FOR SELECT TO authenticated
    USING (public.is_active_user());

DROP POLICY IF EXISTS "Authenticated users can read library_articles" ON public.library_articles;
CREATE POLICY "Active users can read library articles"
    ON public.library_articles FOR SELECT TO authenticated
    USING (public.is_active_user());

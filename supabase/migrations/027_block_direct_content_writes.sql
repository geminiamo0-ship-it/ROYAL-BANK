-- Question content is curated application data. Do not expose generic table CRUD
-- through authenticated clients. Future admin editing should use validated server
-- operations/RPCs or trusted ingestion tooling.

DROP POLICY IF EXISTS "Admins have full access to questions" ON public.questions;
DROP POLICY IF EXISTS "Admins have full access to question_bank_questions" ON public.question_bank_questions;
DROP POLICY IF EXISTS "Admins have full access to options" ON public.options;
DROP POLICY IF EXISTS "Admins have full access to library_articles" ON public.library_articles;

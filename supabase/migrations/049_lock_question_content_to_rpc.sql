-- Close direct client access to paid question content. Exam/library content disclosure
-- must flow through the existing authorized RPC boundaries, which enforce active
-- account, entitlement, session ownership, disclosure windows, and trial controls.

DROP POLICY IF EXISTS "Authenticated users can read questions" ON public.questions;
DROP POLICY IF EXISTS "Authenticated users can read options" ON public.options;
DROP POLICY IF EXISTS "Authenticated users can read question_bank_questions" ON public.question_bank_questions;
DROP POLICY IF EXISTS "Authenticated users can read question_banks" ON public.question_banks;

-- Remove broad table privileges from browser-facing roles. Trusted ingestion uses
-- service_role and remains unaffected.
REVOKE ALL PRIVILEGES ON TABLE public.questions FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.options FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.question_bank_questions FROM anon, authenticated;

-- PostgreSQL column grants are independent of table grants. Explicitly revoke every
-- column privilege so column-specific SELECT cannot bypass the RPC disclosure layer.
REVOKE ALL PRIVILEGES (
    id, main_id, text_html, explanation_html, category, topic, concept,
    concept_id, notes_id, difficulty, source, pm_question_id, concepts_json, created_at
) ON TABLE public.questions FROM anon, authenticated;

REVOKE ALL PRIVILEGES (
    id, question_id, text_html, is_correct, option_order, percentage
) ON TABLE public.options FROM anon, authenticated;

REVOKE ALL PRIVILEGES (
    id, question_bank_id, question_id, shuffle_key
) ON TABLE public.question_bank_questions FROM anon, authenticated;

REVOKE ALL PRIVILEGES ON SEQUENCE public.questions_id_seq FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.options_id_seq FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.question_bank_questions_id_seq FROM anon, authenticated;

COMMENT ON TABLE public.questions IS
'Question content is client-RPC-only. Browser roles have no direct table/column privileges; authorized exam/review RPCs disclose bounded content.';
COMMENT ON TABLE public.options IS
'Answer option content is client-RPC-only. Browser roles have no direct table/column privileges; authorized exam/review RPCs disclose bounded content.';
COMMENT ON TABLE public.question_bank_questions IS
'Question-to-bank mappings are internal to authorization/selection RPCs and are not directly readable by browser roles.';

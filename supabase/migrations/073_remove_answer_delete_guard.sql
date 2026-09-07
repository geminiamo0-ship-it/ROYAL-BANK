-- Remove the transitional answer-delete trigger. Session deletion semantics are
-- intentionally handled by the application/session workflow; a trigger cannot
-- reliably distinguish a direct delete from every FK cascade timing scenario.

DROP TRIGGER IF EXISTS prevent_direct_answer_delete_trigger ON public.user_answers;
DROP FUNCTION IF EXISTS public.prevent_direct_answer_delete();

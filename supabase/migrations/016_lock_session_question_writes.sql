-- The locked question set is security-sensitive. Authenticated clients only need to
-- read their own locked rows; all writes are performed by trusted SECURITY DEFINER
-- session-creation functions. Leaving client INSERT permission in place lets an
-- authenticated user append arbitrary question ids to an owned session.

DROP POLICY IF EXISTS "Users can insert own session questions"
    ON public.test_session_questions;

REVOKE INSERT, UPDATE, DELETE
    ON TABLE public.test_session_questions
    FROM anon, authenticated;

-- Session creation is also RPC-only. Existing owner UPDATE/DELETE permissions stay
-- unchanged because resume/completion/delete workflows legitimately use them.
REVOKE INSERT
    ON TABLE public.test_sessions
    FROM anon, authenticated;

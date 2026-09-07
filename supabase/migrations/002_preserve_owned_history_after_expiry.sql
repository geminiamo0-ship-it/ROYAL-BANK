-- Access expiry removes the right to use bank content, but it must not hide the
-- user's own historical records. Reads of owned history are therefore separated
-- from current bank authorization. Writes/resume/session creation remain governed
-- by the existing current-access policies and RPC checks.

DROP POLICY IF EXISTS "Active users read own accessible test_sessions" ON public.test_sessions;
DROP POLICY IF EXISTS "Active users read own test_sessions" ON public.test_sessions;
CREATE POLICY "Active users read own session history"
    ON public.test_sessions
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = user_id
        AND public.is_active_user()
    );

DROP POLICY IF EXISTS "Active users read own accessible answers" ON public.user_answers;
DROP POLICY IF EXISTS "Active users read own answers" ON public.user_answers;
CREATE POLICY "Active users read own answer history"
    ON public.user_answers
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = user_id
        AND public.is_active_user()
    );

DROP POLICY IF EXISTS "Active users read own accessible notes" ON public.user_notes;
CREATE POLICY "Active users read own note history"
    ON public.user_notes
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = user_id
        AND public.is_active_user()
    );

DROP POLICY IF EXISTS "Active users read own accessible concepts" ON public.saved_concepts;
CREATE POLICY "Active users read own concept history"
    ON public.saved_concepts
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = user_id
        AND public.is_active_user()
    );

DROP POLICY IF EXISTS "Active users read own accessible flags" ON public.user_question_flags;
CREATE POLICY "Active users read own flag history"
    ON public.user_question_flags
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = user_id
        AND public.is_active_user()
    );

COMMENT ON TABLE public.test_sessions IS
'Completed sessions are immutable owned history. Active owners may read historical sessions after bank access expires. Incomplete sessions may be deleted after expiry, but resuming/updating them still requires current bank access.';

COMMENT ON TABLE public.user_answers IS
'Answer rows remain owned history after bank access expires. Reading owned history does not restore current question-bank access or permit answer mutation.';

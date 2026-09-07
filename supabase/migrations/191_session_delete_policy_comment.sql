COMMENT ON POLICY "Active users delete own test_sessions" ON public.test_sessions IS
'Allows an active owner to terminate/delete a session. FK cascade releases locked unanswered questions; free-trial consumption remains in its independent ledger.';

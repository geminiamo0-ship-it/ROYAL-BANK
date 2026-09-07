COMMENT ON COLUMN public.test_sessions.is_completed IS
'Completion transition is validated database-side; application should use complete_exam_session(id) for End Block.';

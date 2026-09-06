COMMENT ON TABLE public.test_sessions IS
'Deleting an unfinished session cascades its locked test_session_questions and answers. Unanswered locks therefore leave Suspended state and become New when no finalized answer exists elsewhere. Trial usage is retained separately.';

ALTER TABLE public.test_sessions
    DROP CONSTRAINT IF EXISTS test_sessions_session_type_check;

ALTER TABLE public.test_sessions
    ADD CONSTRAINT test_sessions_session_type_check
    CHECK (session_type IN (
        'standard',
        'tutor',
        'timed',
        'fixed_timed',
        'mock_exam',
        'review',
        'quick_champion'
    ));

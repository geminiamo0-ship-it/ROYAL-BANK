# Session Lock Rule

Question selection is frozen when a session is created. Refresh/resume must load the same ordered `test_session_questions`; it must not re-run mutable selection filters. Session deletion removes those locks. Completed sessions keep their locked set for history/review while access authorization still applies.

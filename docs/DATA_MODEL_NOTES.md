# Core Data Model Notes

- `test_session_questions` is the immutable locked question set for a session.
- `user_answers` stores one row per session/question; Timed updates that row, Standard/Tutor does not.
- `user_question_flags` stores persistent flags independently of answers.
- latest Correct/Incorrect state is derived across answer history by user/question.
- Suspended is derived from unanswered locks in unfinished sessions.
- `free_trial_block_usage` is independent of session deletion so trial quota is not refundable.
- `user_pathway_access` is premium authorization; per-bank fields configure free trial.

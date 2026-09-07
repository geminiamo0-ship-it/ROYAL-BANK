# Database Trust Boundaries

The hardened core keeps sensitive exam and authorization decisions in PostgreSQL RPCs rather than trusting browser input.

## Core RPCs and helpers

- `can_access_question_bank`: canonical bank-access decision.
- `has_premium_question_bank_access`: canonical premium-access decision for scoped grants.
- `create_exam_session`: validates access, limits, filters and state, then creates the session and locked question set atomically.
- `submit_exam_answer`: mode-aware answer persistence; derives correctness server-side.
- `complete_exam_session`: End Block finalization and timed unanswered handling.
- `get_exam_session_answers`: safe session-answer hydration with correctness masked while mutable timed sessions are active.
- `get_exam_question_feedback`: exposes the answer key/explanation only when feedback is allowed by exam state.
- `set_question_flag`: persistent per-user/per-question flag mutation.
- `get_user_question_states`: canonical New/Correct/Incorrect/Suspended/Flagged state read.
- `update_my_profile`: safe self-service profile updates.

## Browser-visible data

Authenticated browser reads are intentionally column-restricted:

- question content needed to render an active exam may be read;
- option text may be read;
- `options.is_correct` is not browser-readable;
- `questions.explanation_html` is not browser-readable before gated feedback;
- raw answer correctness is not browser-readable;
- the legacy raw latest-answer-state view is not exposed to authenticated users.

Correctness and explanations are delivered through state-aware RPCs instead of direct table reads.

## Session and answer ownership

Session, locked-question and answer operations are user-bound. Completed sessions are immutable and cannot be reopened as active exams. Direct client writes to authorization data, locked question sets, answer correctness and other sensitive structures are restricted.

## Server-only boundary

The Supabase service-role credential is a server-only trusted boundary. Application code using the admin client must remain server-only and must not send privileged raw rows to client components without sanitizing them first.

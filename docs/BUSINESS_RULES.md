# ROYAL-BANK Core Business Rules

## Question state

- New: no surviving finalized answer and no unanswered lock in an unfinished session.
- Suspended: unanswered question locked in an unfinished session.
- Suspended questions are excluded from New.
- A question is counted as Suspended once even if legacy data places it in multiple unfinished sessions.
- Correct/Incorrect is determined by the latest finalized answer from surviving session data. Incorrect -> later Correct becomes Correct.
- Flagged is persistent per user/question and independent of Correct/Incorrect; it remains until manual unflag.

## Session deletion

Deleting an unfinished session deletes the session, its session-scoped answers, and its locked questions. With no separate surviving answer/lock for the same question, every question from that deleted session returns to New. Deleting a session does not refund a consumed free-trial block.

## Answer editing

- Standard/Tutor: selection may change before submit; the persisted submitted answer is final.
- Timed: persisted answer may be changed until End Block.
- End Block finalizes the session and makes its answers immutable.
- Answer correctness is derived from the selected option, never trusted from the client.

## Access

- Banks are configured individually as free-trial or premium-only.
- A pathway may contain any mix of free-trial and premium banks.
- Premium access may be granted globally, to a pathway (including future banks in that pathway), or to selected banks.
- Access starts at `starts_at`; `expires_at = NULL` means lifetime access.
- A free-trial bank has a configurable lifetime block quota per user.
- Quota enforcement is database-side and serialized against concurrent requests.
- Bank metadata may be visible while question content remains locked.

## Block size

Exam blocks are capped at 70 questions.

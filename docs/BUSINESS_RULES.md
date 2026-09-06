# ROYAL-BANK Core Business Rules

## Question state

- New: no finalized answer and no unanswered lock in an unfinished session.
- Suspended: unanswered question locked in an unfinished session.
- Suspended questions are excluded from New.
- A question is counted as Suspended once even if legacy data places it in multiple unfinished sessions.
- Correct/Incorrect is determined by the latest finalized answer. Incorrect -> later Correct becomes Correct.
- Flagged is persistent per user/question and independent of Correct/Incorrect; it remains until manual unflag.

## Session deletion

Deleting an unfinished session releases its unanswered locked questions. They become New when no finalized answer exists elsewhere. Deleting a session does not refund a consumed free-trial block.

## Answer editing

- Standard/Tutor: selection may change before submit; the persisted submitted answer is final.
- Timed: persisted answer may be changed until End Block.
- End Block finalizes the session and makes its answers immutable.
- Answer correctness is derived from the selected option, never trusted from the client.

## Access

- Banks are configured individually as free-trial or premium-only.
- A pathway may contain any mix of free-trial and premium banks.
- Premium pathway access unlocks its banks until the grant expires.
- A free-trial bank has a configurable lifetime block quota per user.
- Quota enforcement is database-side and serialized against concurrent requests.
- Bank metadata may be visible while question content remains locked.

## Block size

Exam blocks are capped at 70 questions.

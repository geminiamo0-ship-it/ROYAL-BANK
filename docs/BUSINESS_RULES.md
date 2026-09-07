# ROYAL-BANK Core Business Rules

## Content hierarchy

- A Pathway contains many Banks.
- A Bank contains many Questions.
- Each Question belongs to exactly one Bank.
- Question IDs are globally unique.

## Question state

- New: no surviving finalized answer and no unanswered lock in an unfinished session.
- Suspended: unanswered question locked in an unfinished session.
- Suspended questions are excluded from New.
- A question is counted as Suspended once even if legacy data places it in multiple unfinished sessions.
- Correct/Incorrect is determined by the latest finalized answer from surviving session data. Incorrect -> later Correct becomes Correct.
- Flagged is persistent per user/question and independent of Correct/Incorrect; it remains until manual unflag.

## Session lifecycle

- Close/Suspend leaves an unfinished session resumable and preserves unanswered locks.
- End Block completes the session.
- Completed sessions are not resumable as active exams and are not deletable through the student session-delete path.
- Deleting an unfinished session deletes the session, its session-scoped answers, and its locked questions. With no separate surviving answer/lock for the same question, every question from that deleted session returns to New.
- Deleting a session does not refund a consumed free-trial block.

## Answer editing and feedback

- Standard/Tutor: selection may change before Submit; the persisted submitted answer is final.
- Standard/Tutor feedback may be revealed after the submitted answer is finalized.
- Timed: persisted answer may be changed until End Block.
- Active Timed sessions must not expose correctness, the correct option, or explanation feedback before End Block.
- End Block finalizes Timed answers and marks every unanswered locked question Incorrect.
- Answer correctness is derived server-side from the selected option and is never trusted from the client.

## Selection

- Selection is random across the entire eligible filtered pool.
- Every eligible question has equal selection probability, so category/topic representation is naturally proportional to the available pool rather than forced into equal quotas.

## Access

- Banks are configured individually as free-trial or premium-only.
- A pathway may contain any mix of free-trial and premium banks.
- Premium access may be granted globally, to a pathway (including future banks in that pathway), or to selected banks.
- Access starts at `starts_at`; `expires_at = NULL` means lifetime access.
- Expiry blocks new protected access but does not erase stored session/history data.
- A free-trial bank has a configurable lifetime block quota per user and configurable per-block question limit.
- Quota enforcement is database-side and serialized against concurrent requests.
- Bank metadata may be visible while question content remains locked.

## Block size

Exam blocks are capped at 70 questions.

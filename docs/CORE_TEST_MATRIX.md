# Core Regression Test Matrix

## Access

- Student cannot open `/admin` or `/support`.
- Support can open `/support` but not `/admin`.
- Inactive staff cannot open privileged routes.
- Free-trial user can read configured trial-bank content only.
- Premium pathway grant unlocks pathway banks until expiry.
- Manipulating bank/question/session IDs cannot expose locked content.

## Trial quota

- Trial bank honors configured block limit.
- Concurrent session-create requests cannot exceed quota.
- Deleting a trial session does not refund quota.
- Changing which bank is trial requires no application hard-coded bank ID.

## Question state

- New excludes finalized answers and unanswered suspended locks.
- Suspended is unique per question across unfinished sessions.
- Deleting unfinished session releases unanswered locks.
- Incorrect -> later Correct becomes Correct and leaves Incorrect Only.
- Flag remains across sessions/correctness until manual unflag.

## Answers

- Wrong selected-option/question relationship is rejected.
- Client cannot forge `is_correct`.
- Standard/Tutor submitted answer cannot change.
- Timed answer can change before End Block.
- Timed answer cannot change after End Block.
- End Block score uses all locked questions as denominator.

## Sessions

- Resume returns same locked question set.
- User A cannot read/update/delete User B session.
- Block cannot exceed 70 questions.
- Completed session cannot reopen.

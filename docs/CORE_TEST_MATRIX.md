# Core Regression Test Matrix

## Access

- Student cannot open `/admin` or `/support`.
- Support can open `/support` but not `/admin`.
- Inactive staff cannot open privileged routes.
- Free-trial user can read configured trial-bank content only.
- Global grant unlocks all banks while active.
- Pathway grant unlocks current and future banks in that pathway while active.
- Bank grant unlocks only the selected bank while active.
- Future and expired grants do not authorize access outside their time window.
- Manipulating bank/question/session IDs cannot expose locked content.

## Trial quota

- Trial bank honors configured lifetime block quota.
- Trial block honors configured per-block question limit and the global 70-question cap.
- Concurrent session-create requests cannot exceed quota.
- Deleting a trial session does not refund consumed quota.
- Premium scoped access bypasses trial limits for the authorized bank.
- Changing which bank is trial requires no hard-coded bank ID in application code.

## Question state

- New excludes finalized answers and unanswered suspended locks.
- Suspended is unique per question across unfinished sessions.
- Incorrect -> later Correct becomes Correct and leaves Incorrect Only.
- Flag remains across sessions/correctness until manual unflag.
- Active Timed selections do not expose Correct/Incorrect before End Block.
- Deleting an incomplete session deletes its session-scoped answers and locks; questions with no other surviving state return to New.

## Answers and feedback

- Wrong selected-option/question relationship is rejected.
- Client cannot forge `is_correct`.
- Standard/Tutor submitted answer cannot change.
- Timed answer can change before End Block.
- Timed answer cannot change after End Block.
- Active Timed submit/hydration/state APIs do not reveal correctness.
- `options.is_correct`, raw answer correctness and the legacy raw answer-state view are not directly readable by authenticated browser clients.
- Explanation/correct-option feedback is gated until Standard/Tutor Submit or End Block for mutable modes.
- End Block marks unanswered Timed questions Incorrect and uses all locked questions as the score denominator.

## Sessions

- Resume returns the same locked question set.
- User A cannot read/update/delete User B session.
- Block cannot exceed 70 questions.
- Completed session cannot reopen as an active exam.
- Completed session cannot be deleted through the student session-delete path.
- Suspend/Close preserves the incomplete session and unanswered locks.

## Database verification

`Verify DB` must successfully:

1. start a local Supabase database;
2. rebuild from every migration in order;
3. run the pgTAP behavior suite in `supabase/tests/`.

Application changes must also pass `npm run verify` when relevant.

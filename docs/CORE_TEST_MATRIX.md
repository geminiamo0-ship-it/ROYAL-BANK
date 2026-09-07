# Core Regression Test Matrix

## Blocking security: authentication, authorization, ownership

- Signup metadata cannot self-promote a user to `admin`/`support`.
- Signup metadata cannot self-promote subscription tier.
- Student cannot open `/admin` or `/support`.
- Support can open `/support` but not `/admin`.
- Inactive staff cannot open privileged routes.
- Inactive users cannot use an otherwise active bank grant.
- User A cannot read/update/delete User B session.
- Manipulating bank/question/session IDs cannot expose another user's protected data.

## Access

- Free-trial user can read configured trial-bank content only.
- Global grant unlocks all banks while active.
- Pathway grant unlocks current and future banks in that pathway while active.
- Bank grant unlocks only the selected bank while active.
- Future and expired grants do not authorize access outside their time window.
- Authenticated users without a grant cannot access paid banks.

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
- Deleting an incomplete session deletes its session-scoped answers and locks; questions with no other surviving state return to New.

## Answers and sessions

- Wrong selected-option/question relationship is rejected.
- Client cannot forge server-derived correctness used for scoring.
- Standard/Tutor submitted answer cannot change.
- Timed answer can change before End Block.
- Timed answer cannot change after End Block.
- End Block marks unanswered Timed questions Incorrect and uses all locked questions as the score denominator.
- Resume returns the same locked question set.
- Block cannot exceed 70 questions.
- Completed session cannot reopen as an active exam.
- Completed session cannot be deleted through the student session-delete path.
- Suspend/Close preserves the incomplete session and unanswered locks.

## Non-blocking anti-cheat checks

The suite under `supabase/tests_optional/` is useful hardening, but it does not block the core baseline or release. It covers things such as hiding `options.is_correct`, option percentages, explanations, raw answer correctness, and early feedback from a user who intentionally inspects browser/database responses.

These checks must never take priority over authentication, pathway/bank authorization, ownership isolation, RLS, session integrity, or trial/access rules.

## Database verification

`Verify DB` must successfully:

1. start a local Supabase database;
2. rebuild from every migration in order;
3. run the blocking pgTAP behavior suite in `supabase/tests/`.

Application changes must also pass `npm run verify` when relevant.

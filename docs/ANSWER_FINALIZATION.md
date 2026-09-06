# Answer Finalization

## Standard / Tutor

Selection can change in UI before submission. The first persisted submitted answer is final and cannot be edited.

## Timed

The persisted answer row may be updated while the block is active. `End Block` finalizes the session; all answers become immutable.

## Integrity

- One answer row per session/question.
- Selected option must belong to the question.
- Question must belong to the locked session set.
- Correctness is database-derived from the selected option.
- End Block score is database-derived using the full locked block size as denominator.

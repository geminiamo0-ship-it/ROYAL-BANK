# Question State Model

For a user/question:

- **Correct / Incorrect**: latest finalized persisted answer from a surviving session.
- **Suspended**: unanswered locked question in an unfinished session; unique by question.
- **New**: no surviving finalized answer and no Suspended lock.
- **Flagged**: persistent orthogonal user-question property until manual unflag.

Examples:

- 100-question session, 20 answered, user leaves -> 20 Answered + 80 Suspended; those 80 are not New.
- Delete that unfinished session -> its 20 session answers and 80 locks are deleted. With no separate surviving state elsewhere, all 100 questions return to New.
- Incorrect today, Correct later -> current state is Correct and it leaves Incorrect Only.
- Correct+Flagged and Incorrect+Flagged are valid combinations.

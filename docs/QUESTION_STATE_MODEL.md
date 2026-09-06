# Question State Model

For a user/question:

- **Correct / Incorrect**: latest finalized persisted answer.
- **Suspended**: unanswered locked question in an unfinished session; unique by question.
- **New**: no finalized answer and no Suspended lock.
- **Flagged**: persistent orthogonal user-question property until manual unflag.

Examples:

- 100-question session, 20 answered, user leaves -> 20 Answered + 80 Suspended; those 80 are not New.
- Delete that unfinished session -> unanswered locks disappear and become New unless answered/locked elsewhere.
- Incorrect today, Correct later -> current state is Correct and it leaves Incorrect Only.
- Correct+Flagged and Incorrect+Flagged are valid combinations.

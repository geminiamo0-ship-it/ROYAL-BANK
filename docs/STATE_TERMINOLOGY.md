# State Terminology

Avoid using `attempted` to mean `answered + suspended`. Use explicit concepts:

- `answeredCount`
- `suspendedCount`
- `unavailableForNewCount` when a combined value is required
- `newCount`

This preserves the intended rule that Suspended is excluded from New without implying a suspended question was actually answered.

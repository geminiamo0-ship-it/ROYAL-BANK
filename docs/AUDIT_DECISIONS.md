# Confirmed Product Decisions

- Progress/Performance/Results/Admin functionality are WIP; security still applies.
- No visual redesign in this pass.
- No important production user data exists yet.
- Standard/Tutor answer final on submit; Timed editable until End Block.
- Latest finalized answer determines Correct/Incorrect.
- Flagged persists until manual unflag.
- Suspended unanswered locks are excluded from New and counted uniquely.
- Deleting unfinished session releases unanswered locks.
- Free trial is configurable per bank/pathway context; premium banks stay locked.
- Free-trial bank has a finite block quota; quota is not bypassable from frontend/API.
- Correctness first, then benchmark/performance; Redis only if justified.
- Strong internal refactor allowed with behavior/UI preserved.
- Proven dead code should be deleted.
- Work stays off `main` until validated.

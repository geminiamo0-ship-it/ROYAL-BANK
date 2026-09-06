# Core Hardening Status

## Completed in this branch

- Core audit scope/business rules documented.
- Admin/support server-side route authorization.
- RLS privilege-escalation fixes.
- Signup role-injection fix.
- Premium question-content access boundary.
- Configurable per-bank free-trial model.
- Database-side trial quota and consumption ledger.
- Persistent user-question flags.
- Latest-answer Correct/Incorrect semantics.
- Canonical New/Suspended/Flagged state RPC.
- Answer ownership/option/correctness validation.
- Standard/Tutor vs Timed finalization guards.
- Trusted End Block completion RPC and score derivation.
- Bank-aware materialized category/topic counts and indexes.
- Access-change audit logs.
- Data integrity constraints and supporting indexes.

## Remaining before merge

- Integrate application Server Actions with the new canonical RPCs/access model.
- Remove hard-coded Bank 1 authorization from application code.
- Replace legacy answer-flag queries with persistent flag state.
- Replace JS question-state aggregation with database state RPC.
- Harden silent answer-save error handling.
- Validate create_exam_session implementation against new RLS/quota/locking rules.
- Verify migration chain against a disposable Supabase instance.
- Run build/lint/typecheck and fix regressions.
- Prove and delete dead root scratch/fix files.
- Refactor oversized core modules after behavior is covered.
- Benchmark completed core flows; decide on Redis only from measured bottlenecks.

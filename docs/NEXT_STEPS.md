# Next Steps on `audit/core-hardening`

1. Read/fetch the complete current `create_exam_session` SQL definition and replace it if it does not satisfy the documented trusted-session contract.
2. Update `src/actions/exam.ts` to use `submit_exam_answer`, `complete_exam_session`, persistent flag RPC, and canonical question-state RPC; remove silent answer retry/failure handling.
3. Replace hard-coded Bank 1 access checks with bank/pathway access metadata.
4. Update question-bank aggregation to consume database state/count RPCs and remove duplicated category fallbacks/circular types.
5. Verify Previous Sessions against completed/incomplete state and session deletion semantics.
6. Run the full migration chain on a disposable Supabase database, then squash the exploratory migration sequence into a clean pre-production baseline.
7. Run build/lint/typecheck and add integration tests for docs/SECURITY_HARDENING.md and docs/BUSINESS_RULES.md.
8. Prove/remove dead root scripts and refactor oversized core modules.
9. Benchmark completed core flows; only then decide whether Redis adds measurable value.

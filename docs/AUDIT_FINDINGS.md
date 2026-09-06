# Confirmed Audit Findings

## Critical / High

1. Admin/support route trees were authentication-only, not role-gated. Server-side role layouts added on audit branch.
2. Profile UPDATE RLS allowed self-updates to a row containing role/subscription/is_active, creating privilege escalation risk.
3. Signup trigger trusted role from user metadata, enabling role injection if registration metadata were manipulated.
4. Authenticated users could directly SELECT all questions/options/mappings, bypassing application-level premium checks.
5. SECURITY DEFINER analytics accepted arbitrary user IDs without caller authorization.
6. Answer writes trusted client relationships/correctness too much and could silently fail in application code.
7. Trial access was hard-coded around Bank 1 in application/SQL paths instead of bank configuration.
8. Trial quota was not an authoritative database-side lifetime ledger.

## Business correctness

9. Current answer-history queries need latest-answer semantics: later Correct must move a question out of Incorrect.
10. Persistent Flagged state needs a user-question table rather than an answer-row snapshot.
11. Suspended must mean unanswered locked questions in unfinished sessions, unique by question and excluded from New.
12. Standard/Tutor and Timed answer finalization rules need different database behavior.
13. Session End Block score must be derived from persisted answers and the full locked block size.

## Maintainability / performance

14. Duplicate category fallback definitions conflict and need one source of truth.
15. `exam.ts` and Question Bank client are oversized and mix responsibilities.
16. Question-state aggregation currently belongs closer to Postgres/RPC than large JS-side history scans.
17. Bank 1 has legacy special-case query paths that should be normalized into bank mappings.
18. Root scratch/fix/rewrite artifacts need usage proof then deletion if dead.
19. Migration history already contains overlapping performance patches and a numbering gap; the exploratory audit migrations must be squashed before production.
20. Redis should not be added until optimized DB/RPC flows are benchmarked.

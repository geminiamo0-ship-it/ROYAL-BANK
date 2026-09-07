# ROYAL-BANK Core Audit

## Scope

Completed/core areas receive full correctness, security, maintainability, and performance review:

- Question Bank / question selection
- Exam page and exam session engine
- Previous Sessions
- Authentication and authorization
- Subscription / bank access infrastructure
- Supabase schema, RLS, RPCs, and migrations

WIP/mock areas (Progress, Performance, Results, Admin UI and other unfinished pages) are not judged for feature completeness or mock data. Security and shared-infrastructure issues are still in scope.

No visual redesign is part of this pass. Functional UI bugs may be fixed.

## Product rules

- `New`: never finalized/answered and not reserved unanswered in an unfinished session.
- `Suspended`: reserved in an unfinished session and still unanswered.
- Suspended questions are excluded from New.
- Deleting an unfinished session releases its unanswered questions back to New when they have no finalized answer elsewhere.
- Correct/Incorrect is determined by the latest finalized answer.
- Flagged is a persistent user-question property until the user manually unflags it.
- Standard/Tutor: selection may change before Submit; Submit finalizes the answer.
- Timed: answers remain editable until End Block; End Block finalizes them.
- A question must not be double-counted as Suspended because it appears in multiple unfinished sessions.
- Premium banks remain locked to unauthorized users.
- Free-trial bank access must be configurable per pathway/bank and enforce a configurable block quota server-side; it must not rely on a hard-coded bank ID.

## Initial confirmed findings

### Critical / High

1. Admin and support routes were authentication-only at middleware level; no role gate protected the route tree. Fixed on this branch with server-side layouts.
2. The original profiles UPDATE RLS policy allowed a user to update their own profile row without column-level protection. Because role, subscription tier, and active state live on that row, this creates a privilege/subscription escalation path. A hardening migration now restricts profile updates to admins until a safe self-service profile update RPC/policy is designed.
3. `get_user_category_analytics(p_user_id)` was SECURITY DEFINER and accepted an arbitrary user UUID without authorization. The hardening migration scopes it to the current user or support/admin.
4. Authenticated users currently have direct SELECT access to all questions/options/question-bank mappings. This means premium content protection cannot rely only on `startExamSession`. This needs a dedicated content-access redesign before production.

### Medium / maintainability

5. Question state aggregation and answer history need verification against latest-finalized-answer semantics and unique Suspended semantics.
6. Free trial access is currently partially hard-coded in application logic and must become bank/pathway configuration with server/DB-enforced quotas.
7. Duplicate/default category definitions need one source of truth.
8. Answer persistence has failure paths that can be silent and must be hardened.
9. Large exam/question-bank modules should be split after behavior is protected with tests.
10. Root scratch/fix/rewrite files require usage verification and deletion when proven dead.

## Next implementation sequence

1. Complete RLS/RPC security audit.
2. Formalize question-state/finalization schema and queries.
3. Replace hard-coded free-trial bank logic with configurable access policy and quota enforcement.
4. Harden answer persistence and session deletion/resume behavior.
5. Add high-value business-rule tests.
6. Remove proven dead code and duplicate definitions.
7. Refactor large modules without changing UI/behavior.
8. Measure core flows and optimize real bottlenecks; consider Redis only after measurement.

# Exam bootstrap security matrix

This document is the approval boundary for latency work on exam-session creation. Performance changes MUST NOT weaken authentication, authorization, ownership, trial quota enforcement, or answer secrecy.

## Non-negotiable invariants

- `auth.uid()` is the authenticated identity. The client never supplies a trusted user id.
- A caller must be active and entitled to the requested question bank, or be eligible for that bank's configured free trial.
- Trial block quota remains authoritative inside the `test_sessions` insert trigger and remains serialized by its transaction advisory lock.
- Session ownership is a separate check from bank entitlement and must never be inferred from entitlement.
- No GUC, request header, client payload, cache entry, or other caller-influenced value is accepted as proof of authorization.
- Unanswered question payloads must not expose `explanation_html`, `options.is_correct`, option percentages, or a correct option id.
- `record_free_trial_session_usage()` is not part of latency optimization until a dedicated concurrency/security review is completed.

## Authorization / integrity matrix

| Check | Current location | Exact purpose | Can change during one READ COMMITTED transaction? | Security impact if stale | Reuse/caching decision | Review status / evidence required |
| --- | --- | --- | --- | --- | --- | --- |
| `auth.uid()` | bootstrap RPC + ownership-sensitive RPCs/triggers | Establish caller identity | JWT identity is request-bound; database state around it may change | Critical: wrong identity is an ownership bypass | Reuse only as a local variable derived from `auth.uid()` in the same function call; never accept a client user id | APPROVED invariant; auth/ownership tests required |
| `is_active_user()` | bootstrap access path + trial insert trigger | Reject suspended/inactive accounts | Yes: an admin can change `profiles.is_active` between statements under READ COMMITTED | High: a newly suspended account could continue if an earlier result were blindly reused | Do not remove the trigger's fresh check in the current optimization phase | LOCKED until explicit authorization-snapshot semantics are approved |
| `has_premium_question_bank_access(bank)` | bootstrap RPC + trial insert/usage trigger paths | Resolve scoped premium entitlement (admin/support, active access grants, pathway premium access) | Yes: grants/expiry/account state can change between statements | High: stale `true` could preserve access after revocation | No trust hand-off through GUC/cache. Current trigger calls remain authoritative in this phase | MEASURE first; any deduplication needs semantic + concurrency review |
| Bank existence / trial configuration | bootstrap RPC + trial trigger | Validate bank and read `is_free_trial`, question/block limits | Yes, though configuration changes should be rare | Medium/high: stale trial configuration could grant the wrong limits | Local values may drive selection in the bootstrap RPC, but insert triggers remain authoritative for trial enforcement | APPROVED only for current RPC-local selection behavior |
| Trial advisory lock | `enforce_free_trial_session_quota()` BEFORE INSERT | Serialize concurrent trial-session creation for the same user/bank | N/A: it is synchronization, not cached data | Critical: bypass can oversubscribe quota | NEVER cache, skip, or move outside the authoritative enforcement sequence | LOCKED; concurrency evidence required for any change |
| Trial usage count / quota comparison | `enforce_free_trial_session_quota()` under advisory lock | Enforce block limit atomically | Yes, especially under concurrent requests | Critical: stale count can allow extra blocks | NEVER reuse a pre-lock count as authoritative | LOCKED; concurrency evidence required |
| Trial usage ledger write | `record_free_trial_session_usage()` AFTER INSERT | Persist consumed trial block | Changes with each successful trial creation | Critical: missed write can effectively refund/bypass quota | Do not optimize in this phase | LOCKED; dedicated security + concurrency review required |
| Session ownership | session bootstrap/window/answer/complete RPCs | Ensure the requested session belongs to `auth.uid()` | Session owner should be immutable; caller identity is request-specific | Critical: BOLA/IDOR if omitted | Never merge with bank-entitlement checks | LOCKED invariant; foreign-user tests required |
| Question/option secrecy before submit | create bootstrap + window RPCs | Prevent answer leakage through Network/DevTools | Data itself can change, but secrecy rule is invariant | Critical to exam integrity | Safe payload may be built directly from known selected ids, but must contain only the approved fields | APPROVED with payload-leakage tests |

## Approved optimization scope: inline create bootstrap

The current low-risk optimization may reuse **non-authorization values that this same function just produced**:

- the `test_sessions` row returned by `INSERT ... RETURNING`;
- `selected_question_ids` already selected by the function;
- `current_index = 0` for a brand-new session;
- `answers = []` for a brand-new session;
- the first selected question id for a safe Q1 payload;
- flags derived directly from the already selected ids plus the authenticated user's flag table.

This removes read-after-write work from `get_exam_session_bootstrap()` / `get_exam_session_window()` after creation. It does **not** remove or weaken any trigger, access check, advisory lock, quota check, ownership rule, or free-trial ledger write.

## READ COMMITTED decision

We explicitly do **not** adopt an "authorization snapshot at start of exam creation" policy in this phase. Fresh trigger-side checks remain in place. If a future optimization wants to reuse an earlier authorization result across statements, that is a security-semantics change and requires explicit approval, documentation next to the code, and tests for revocation/suspension races.

## GUC / pooled-connection rule

Transaction-local settings may be useful for diagnostics, but they are never a security proof. No trigger may trust a custom GUC or request-derived setting as evidence that a user is premium, active, owns a session, or is within quota.

## Existing advisor findings discovered during this review

Supabase's security advisor currently reports pre-existing warnings for several `SECURITY DEFINER` functions exposed from `public`, plus unrelated search-path/materialized-view findings. Some exposed RPCs contain their own admin/support checks, but the exposure should be audited separately rather than silently accepted. This performance PR must not broaden any function privilege.

Relevant Supabase remediation references:

- SECURITY DEFINER exposure: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- Mutable function search path: https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable
- Materialized view exposed to API: https://supabase.com/docs/guides/database/database-linter?lint=0016_materialized_view_in_api

## Merge gate

A latency change touching this path is mergeable only when all of the following are true:

1. Existing DB/security tests pass.
2. New tests prove payload secrecy and foreign-user isolation.
3. Trial quota tests still prove that usage is consumed and a second over-limit block is rejected.
4. Function privileges remain `authenticated = execute`, `anon = no execute` for public exam RPCs intended only for signed-in users.
5. No trial/advisory-lock/ledger behavior was weakened.
6. The change produces a measured latency improvement after deployment; otherwise it should be reverted or justified for another reason.

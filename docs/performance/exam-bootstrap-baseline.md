# Exam bootstrap latency baseline

Captured from production Supabase before the inline-bootstrap optimization.

## Current production measurements

`pg_stat_statements` for the PostgREST call to `create_exam_session_bootstrap` currently reports:

| Metric | Value |
| --- | ---: |
| Calls | 6 |
| Mean DB execution | 151.490 ms |
| Minimum DB execution | 60.697 ms |
| Maximum DB execution | 311.646 ms |
| Total DB execution | 908.941 ms |

This is **not** enough data to claim a stable P50/P95/P99. The 5x min-to-max spread means the next decision must be based on a larger real-traffic sample.

## Measurement limitations

Production currently has:

- `pg_stat_statements.track = top`
- `track_functions = none`

Therefore `pg_stat_statements` gives a reliable aggregate for the top-level Data API RPC, but it does not provide a complete per-statement/per-PLpgSQL-function breakdown of the work inside `create_exam_session_bootstrap`.

We deliberately do not enable deeper production tracking in this change because doing so can add observability overhead and changes a database-wide setting. If deeper profiling becomes necessary, it should be enabled temporarily under a separate measurement plan.

## Sample target

Before making any higher-risk authorization/trigger optimization, collect at least 50–100 real launch calls and segment results by:

- `question_selection`: `new_only`, `all`, `flagged_only`, `incorrect_only`, `suspended_only`;
- requested question count (especially 40 vs 70);
- timestamp / traffic period;
- client-observed end-to-end latency where available.

Where possible, distinguish a warm path from first/idle requests. Do not infer connection-pool/cold-cache behavior from DB execution time alone.

## Before/after comparison rule

For the inline-bootstrap change, compare at minimum:

- top-level RPC mean/min/max after enough calls;
- client Waiting/TTFB for the same launch scenario;
- error rate;
- DB/security test results;
- trial quota behavior.

The target is lower latency without changing security semantics. A faster result with weaker authorization, quota enforcement, ownership, or answer secrecy is a failed optimization.

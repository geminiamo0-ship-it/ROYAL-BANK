# Exam observability and bounded load tests

The instrumentation is opt-in via the existing `ROYAL_GATEWAY_TIMING_ENABLED=true` environment setting. It changes diagnostics, not authorization, persistence or request deadlines.

## Timing interpretation

| Server-Timing field | What it measures |
| --- | --- |
| middleware | Proxy session extraction/refresh until forwarding; excluded from total_server |
| body_parse | Read and validate request body |
| auth | Route authentication checks |
| rate_limit | Vercel rate-limit call; denial accounting may fall outside this field |
| release_lookup | Resolve the active R2 content release for Create |
| upstream_fetch | RPC fetch, including network/PostgREST/database waiting; not pure SQL time |
| response_read | Read the RPC response body |
| r2_hydrate | Hydrate references with pinned R2 content, including local cache hits |
| window_fast_path | Signed window lookup, independent of database upstream time |
| window_sign | Attach the signed window-access capability |
| total_server | Entire route handler until returning the response; excludes middleware/platform/network/client time |

Returned error responses receive the same timing header and `x-royal-request-id` as successful responses. Timeouts retain `x-royal-timeout-stage`. When the environment supplies a valid `VERCEL_GIT_COMMIT_SHA`, timing-enabled responses also expose `x-royal-build`; absence must not be treated as proof of a deployment version.

Proxy deletes caller-supplied `x-royal-internal-middleware-ms` and overwrites it with measured time when enabled. The route bounds this diagnostic value. No authentication decision uses it. No request bodies, JWTs, user IDs or question content are added to the diagnostics.

Client elapsed time minus total_server is not automatically a cold start or Vercel queue measurement. It can include proxy execution, transport, platform waiting, connection scheduling and response transfer. Middleware timing is useful for narrowing this gap but cannot account for all of it.

## Controlled workload

The authenticated workflow targets only the known Royal deployment and checks the Supabase project hostname before preparing or cleaning up users. It uses GitHub's production environment secrets; no service key is committed. Run `Authenticated staged exam load` on the reviewed branch through workflow_dispatch when enabled. The existing diagnostic runner can also check out an exact reviewed tooling commit.

1. Prepare 94 isolated accounts, one bank access grant per account, and cookie sessions, pacing authentication separately from load. Reserve four accounts for selector preflights and separate cohorts of 10/30/50 for the stages. Each measured account creates only one seed and two measured sessions, staying below the live four-per-10-minute burst threshold and three-active-session cap.
2. In batches of three independent journeys, create a 40-question session for each account, submit one deliberately incorrect answer through the API, verify it on resume, complete, and verify it in review. The incorrect option lookup is restricted to a question already disclosed to that test account. This is light history, not a long-lived student's complete history.
3. Preflight all four selectors.
4. Schedule open-loop arrival rates of 1, 3 and 5 Create requests/second, for 20 seconds per stage. No retries hide errors. All in-flight requests drain before cleanup. The latest scheduler preserves the full scheduled interval even when the last response returns early.
5. Stop scheduling when any request fails, an individual response exceeds 5 seconds, observed p95 exceeds 2.5 seconds, launch lag exceeds 200 ms, in-flight requests reach 20, or another request would overlap for the same test user. These are diagnostic stop thresholds, not a claimed product SLA.
6. Delete the isolated sessions/grants/users in an always-run cleanup step. Cleanup verifies that every recorded ID belongs to this workflow run's test email prefix before deletion.

The selectors are `all`, `new_only`, `filtered` (difficulty 1), and `incorrect_only`. The first three request 40 questions. Incorrect-only requests **one** question because the fixture has one known incorrect answer; compare it separately. The report contains per-scenario counts and percentiles. Setup calls are excluded from load-stage percentiles.

The successful_rps denominator includes the full configured stage duration and response drain when longer. Any incomplete stage fails. A successful short stage is not a long-duration capacity guarantee, and these fixtures do not model expensive category/topic combinations, trial quotas, or heavy user histories.

## Verification

Run `node --test scripts/exam-load-metrics.test.mjs scripts/exam-timing.test.mjs`, then the repository verification command. The regression tests exercise failure gates, route success/error/timeout timing, signed-window timing separation, and removal of forged middleware headers.

Tests use controlled transport/auth doubles locally; they are not evidence of production provider latency. The production load report separately records its tooling commit and any deployment commit actually returned by the target. A runner checkout pin is the authoritative tooling revision when reading older report formats.

## Rollout

Review and deploy the instrumentation, then confirm the deployment commit header and new timing fields on the actual target before attributing production measurements to this code. No database migration is required. Disabling the timing environment flag disables timing and build headers; request IDs remain available.

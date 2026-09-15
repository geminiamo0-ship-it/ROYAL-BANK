# Royal Bank staged load results — 2026-09-14
Verified and recorded on 2026-09-15.

## Outcome
All 180 measured Create requests succeeded. All 568 setup API requests succeeded, including verification of persisted incorrect answers on resume and completed review for 94 isolated users.

| Offered Create RPS | Cohort users | Requests | Errors | p50 ms | p95 ms | Max ms | Successful RPS including drain |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 10 | 20 | 0 | 442.0 | 737.9 | 749.9 | 1.00 |
| 3 | 30 | 60 | 0 | 422.0 | 463.8 | 515.3 | 2.99 |
| 5 | 50 | 100 | 0 | 410.9 | 490.0 | 638.1 | 4.93 |

Each stage schedules arrivals over 20 seconds. These are short controlled stages, not maximum capacity or a long-duration SLA. Client latency is measured from a GitHub Actions runner.

The workload mixes four selectors equally: all, new_only, difficulty-1 filtered (40 questions each), and incorrect_only (one seeded incorrect question). At the 5-RPS stage, the 75 forty-question requests had p50 428.3ms, p95 513.2ms and max 638.1ms. The whole mixed stage must not be described as exclusively 40-question creates.

At 5 RPS, measured route total_server had p50 117.5ms / p95 170.1ms; upstream_fetch had p50 33.5ms / p95 48.3ms. Upstream includes transport/PostgREST/DB waiting, not pure SQL. The external/route time gap cannot yet be assigned to a specific provider.

## Evidence and provenance
- [Successful staged run 34901915384](https://github.com/geminiamo0-ship-it/ROYAL-BANK/actions/runs/34901915384)
- Tooling checkout: da8efa0ac39538b44633be8db3f78142ad14f420.
- Runner workflow commit: e83bf60cb8320e04e3a23c456f93a848093ee2f1.
- Target: https://royal-bank-nhr8.vercel.app.
- [Successful code CI](https://github.com/geminiamo0-ship-it/ROYAL-BANK/actions/runs/34901884040): build, typecheck, audits and 11 regression tests; lint has three pre-existing warnings.
- Cleanup succeeded: 94/94 users removed, and a subsequent read-only production query confirmed zero remaining users for this run.

## Initial test corrected
[Run 34901529598](https://github.com/geminiamo0-ship-it/ROYAL-BANK/actions/runs/34901529598) used 16 accounts and hit SESSION_BURST_LIMIT on the first request of the 3-RPS stage after passing 1 RPS. Live policy permits four creations per ten minutes, then a 30-minute account block; active sessions are capped at three. This was a test-fixture conflict with account policy, not server saturation.

The successful rerun reserved four accounts for preflights and used disjoint 10/30/50-user cohorts. Each measured account created one completed seed session plus two measured sessions. Production protection settings were not changed. Initial-run cleanup also removed all 16 users.

## Instrumentation rollout remains blocked
The new middleware/release/R2 timings are implemented and tested in PR #66, but were not deployed to the measured production target. The responses did not expose x-royal-build, so the exact deployed source commit is unconfirmed.

GitHub reported the nhr8 Vercel deployment as blocked. The connected Vercel API returned HTTP 403 and requested authentication to the project scope. This prevents inspection of the detailed deployment failure and verification of a new deployment. Resolve project-scoped Vercel access and deploy the reviewed change before interpreting live data as measurements from the new instrumentation.

No database migration or provider migration was performed. These measurements do not support a claim of 1000 Create requests/second. The fixture includes light history only, not heavy histories, complex category/topic combinations or trial quotas.

## Sanitized summary
```json
{
  "at": "2026-09-14T22:05:25.779Z",
  "deployed_commits": [],
  "history_verified_users": 94,
  "passed": true,
  "setup": {
    "errors": 0,
    "max_ms": 2718.8,
    "p50_ms": 367,
    "p95_ms": 536.1,
    "requests": 568,
    "successful": 568
  },
  "stages": [
    {
      "by_scenario": {
        "all": {
          "errors": 0,
          "max_ms": 737.9,
          "p50_ms": 442,
          "p95_ms": 737.9,
          "requests": 5,
          "successful": 5
        },
        "filtered": {
          "errors": 0,
          "max_ms": 749.9,
          "p50_ms": 464.9,
          "p95_ms": 749.9,
          "requests": 5,
          "successful": 5
        },
        "incorrect_only": {
          "errors": 0,
          "max_ms": 565.6,
          "p50_ms": 403.6,
          "p95_ms": 565.6,
          "requests": 5,
          "successful": 5
        },
        "new_only": {
          "errors": 0,
          "max_ms": 593.2,
          "p50_ms": 440,
          "p95_ms": 593.2,
          "requests": 5,
          "successful": 5
        }
      },
      "cohort_users": 10,
      "duration_seconds": 20,
      "elapsed_ms": 19999.3,
      "errors": 0,
      "expected_requests": 20,
      "max_ms": 749.9,
      "offered_rps": 1,
      "p50_ms": 442,
      "p95_ms": 737.9,
      "passed": true,
      "requests": 20,
      "stop_reason": null,
      "successful": 20,
      "successful_rps": 1
    },
    {
      "by_scenario": {
        "all": {
          "errors": 0,
          "max_ms": 462.4,
          "p50_ms": 428.2,
          "p95_ms": 462.4,
          "requests": 15,
          "successful": 15
        },
        "filtered": {
          "errors": 0,
          "max_ms": 441.1,
          "p50_ms": 426.8,
          "p95_ms": 441.1,
          "requests": 15,
          "successful": 15
        },
        "incorrect_only": {
          "errors": 0,
          "max_ms": 454.5,
          "p50_ms": 399.9,
          "p95_ms": 454.5,
          "requests": 15,
          "successful": 15
        },
        "new_only": {
          "errors": 0,
          "max_ms": 515.3,
          "p50_ms": 429.2,
          "p95_ms": 515.3,
          "requests": 15,
          "successful": 15
        }
      },
      "cohort_users": 30,
      "duration_seconds": 20,
      "elapsed_ms": 20095.8,
      "errors": 0,
      "expected_requests": 60,
      "max_ms": 515.3,
      "offered_rps": 3,
      "p50_ms": 422,
      "p95_ms": 463.8,
      "passed": true,
      "requests": 60,
      "stop_reason": null,
      "successful": 60,
      "successful_rps": 2.99
    },
    {
      "by_scenario": {
        "all": {
          "errors": 0,
          "max_ms": 513.2,
          "p50_ms": 410.9,
          "p95_ms": 479.6,
          "requests": 25,
          "successful": 25
        },
        "filtered": {
          "errors": 0,
          "max_ms": 548.8,
          "p50_ms": 413.4,
          "p95_ms": 490,
          "requests": 25,
          "successful": 25
        },
        "incorrect_only": {
          "errors": 0,
          "max_ms": 549.6,
          "p50_ms": 366.8,
          "p95_ms": 473.8,
          "requests": 25,
          "successful": 25
        },
        "new_only": {
          "errors": 0,
          "max_ms": 638.1,
          "p50_ms": 441.9,
          "p95_ms": 545.6,
          "requests": 25,
          "successful": 25
        }
      },
      "cohort_users": 50,
      "duration_seconds": 20,
      "elapsed_ms": 20275.7,
      "errors": 0,
      "expected_requests": 100,
      "max_ms": 638.1,
      "offered_rps": 5,
      "p50_ms": 410.9,
      "p95_ms": 490,
      "passed": true,
      "requests": 100,
      "stop_reason": null,
      "successful": 100,
      "successful_rps": 4.93
    }
  ],
  "target": "https://royal-bank-nhr8.vercel.app",
  "tooling_commit": "da8efa0ac39538b44633be8db3f78142ad14f420"
}
```

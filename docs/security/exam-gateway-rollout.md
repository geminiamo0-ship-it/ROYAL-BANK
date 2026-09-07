# Royal Exam Gateway Rollout

This runbook activates the gateway only after the staged code and DB hook are deployed.

## Required server-only Vercel environment variables

- `ROYAL_GATEWAY_KEY_ID`
- `ROYAL_GATEWAY_KEY` — high-entropy random secret; never expose to the browser or repository
- `ROYAL_RISK_HMAC_SECRET` — separate high-entropy random secret for keyed IP/User-Agent pseudonyms

The browser feature flag is intentionally separate:

- `NEXT_PUBLIC_EXAM_GATEWAY_ENABLED=true`

Do not enable the browser flag until the server-only variables are present.

## Gateway key rotation

1. Generate a new random gateway secret.
2. Insert only `extensions.digest(secret, 'sha256')` into `private.exam_gateway_keys` with a new `key_id`.
3. Keep the previous key enabled during the rollout grace period.
4. Deploy Vercel with the new `ROYAL_GATEWAY_KEY_ID` and `ROYAL_GATEWAY_KEY`.
5. Verify gateway traffic succeeds from all active regions.
6. Disable or expire the previous DB key.

Never commit or log the raw secret.

## Vercel WAF / RPC rate-limit contract

The durable request-rate layer belongs at Vercel, not PostgreSQL.

- `window`: 20 requests/minute per verified user scope
- `submit`: 20 requests/minute per verified user
- `create`: 4 requests/minute per verified user
- `complete`: 4 requests/minute per verified user
- all exam gateway requests combined: about 60 requests/minute per verified user

Recommended rollout:

1. Create the Vercel rate-limit rules in **Log** mode first.
2. Observe legitimate traffic and duplicate-prefetch behavior.
3. Switch to 429 enforcement once normal request distributions are confirmed.
4. Repeated 429 abuse escalates to 15m, then 1h, then 3h restrictions/challenge as designed.

Do not implement request counters with per-request writes in PostgreSQL and do not use `pg_sleep` for throttling.

## Activation order

1. Deploy this staged PR with DB `exam_gateway_config.enforcement_enabled = false`.
2. Configure Vercel server secrets.
3. Insert the matching gateway key digest in `private.exam_gateway_keys`.
4. Turn on `NEXT_PUBLIC_EXAM_GATEWAY_ENABLED` and deploy the frontend cutover.
5. Verify `/api/exam` latency and all exam actions.
6. Confirm direct browser calls to Supabase are no longer used by the frontend.
7. Enable Vercel WAF rate limits.
8. Set `private.exam_gateway_config.enforcement_enabled = true`.
9. Verify direct protected Supabase RPC calls now return `GATEWAY_REQUIRED` while gateway traffic succeeds.

Never enable step 8 before steps 2–6 are verified.

## Protected RPC surface

- `create_exam_session_bootstrap`
- `create_exam_session_bootstrap_idempotent`
- `get_exam_session_bootstrap`
- `get_exam_session_window`
- `submit_exam_answer_with_feedback`
- `submit_exam_answer`
- `get_exam_question_feedback`
- `set_question_flag`
- `complete_exam_session`

The gateway forwards the original user JWT. It does not use `service_role` for normal exam traffic.

## Security invariants

- `auth.uid()` remains the DB identity source.
- Fresh entitlement and ownership checks stay inside the existing RPCs.
- Free-trial trigger semantics remain unchanged.
- Future unanswered questions never include correct-option state, explanation, percentages, or other feedback secrets.
- Gateway proof is not a substitute for entitlement/auth checks.
- IP and User-Agent are risk signals only, not identity proofs.

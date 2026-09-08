# Vercel BFF backend-concealment rollout

The browser must communicate only with Royal/Vercel routes. Backend provider credentials, hosts, auth endpoints, database APIs, and exam RPC endpoints stay server-side.

## Required Vercel environment variables

Add these to Preview and Production before merging/deploying this branch:

- `SUPABASE_URL` — existing project URL, server-only.
- `SUPABASE_PUBLISHABLE_KEY` — project publishable key (or set `SUPABASE_ANON_KEY` temporarily for a legacy anon key).
- `SUPABASE_SERVICE_ROLE_KEY` — keep server-only where existing admin workflows require it.
- `ROYAL_APP_URL` — canonical production Royal origin, for example `https://your-royal-domain.example`.
- Existing Royal gateway/risk/rate-limit secrets remain server-only.

After a verified production deploy, remove `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from Vercel. The server config contains a temporary compatibility fallback so rollout can be staged safely; no client module reads those variables.

## Royal email confirmation

In the hosted authentication dashboard:

1. Set **Site URL** to the canonical Royal production origin.
2. Ensure the Royal production origin is in the redirect allow-list.
3. In the **Confirm signup** email template, use this Royal link instead of the provider-hosted confirmation URL:

```text
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
```

4. Use Royal/custom SMTP for production branding if desired.

The application route `/auth/confirm` verifies the token server-side and establishes the hardened Royal cookie session.

## Browser boundary

- Exam actions are always sent to `/api/exam`; there is no direct RPC fallback.
- The browser-side backend SDK and backend DNS/preconnect hints are removed.
- Auth is performed by Server Actions on Vercel.
- The auth cookie uses the Royal name `royal-auth`, is `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- Middleware overwrites any browser-provided exam Authorization header and injects the validated cookie session server-side.

## Storage and Realtime

At implementation time the production project had no Storage buckets and no tables in the Realtime publication, so no browser Storage/Realtime migration was required. If either feature is added later, it must go through an explicit Royal/Vercel BFF route rather than exposing a provider URL to the browser.

## Verification

`npm run verify` now runs both source and built-client audits. The audit fails if a client component or `.next/static` bundle contains provider names, browser SDK references, public backend env names, or direct REST/Auth/Storage/Realtime endpoint paths.

After deployment, also verify manually in a clean browser:

- Network requests resolve only to Royal/approved third-party domains.
- No provider hostname appears in page source or loaded JavaScript.
- Cookies use Royal naming and auth cookies are HttpOnly.
- Registration email points directly to the Royal domain.
- Login, refresh, exam create/bootstrap/submit/feedback/complete, logout, and email confirmation all work.

For production concealment, keep gateway timing diagnostics disabled unless their metric names have been reviewed for provider-neutral terminology.

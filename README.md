# ROYAL-BANK

ROYAL-BANK is a Next.js + Supabase medical question-bank application. The current core covers question-bank selection, exam sessions, previous sessions, scoped access, free-trial quotas, persistent flags, and server-enforced answer finalization.

## Local app setup

Requirements:

- Node.js 20+
- npm
- Supabase project credentials for app runtime

Install and run:

```bash
npm ci
npm run dev
```

Required application environment variables include:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Keep local environment files out of Git.

## App verification

Run the full application verification gate with:

```bash
npm run verify
```

This runs lint, TypeScript checking, and a production build.

## Local database verification

The repository includes Supabase CLI configuration, migrations, and database behavior tests.

With Docker available:

```bash
supabase db start
supabase db reset
supabase test db
```

`db reset` rebuilds the local database from the migration history. `supabase test db` verifies the core access, trial, session, answer-state, deletion, and exam-finalization contracts.

## Core architecture

The preferred request path for sensitive exam operations is:

```text
Browser
  -> Next.js server action
  -> authentication / validation
  -> Supabase RPC
  -> Postgres constraints, triggers, and RLS
```

The browser must not be trusted with answer correctness or other privileged exam state before the relevant answer/block is finalized.

## Durable project rules

The maintained core documentation lives under `docs/`, especially:

- `BUSINESS_RULES.md`
- `ACCESS_MODEL.md`
- `QUESTION_STATE_MODEL.md`
- `DATABASE_BOUNDARIES.md`
- `SECURITY_HARDENING.md`
- `CORE_TEST_MATRIX.md`

## Development status

The core is being hardened before unfinished areas such as Progress, Performance, Results, MOOCs, and broader Admin Dashboard functionality are expanded. Avoid treating placeholder/WIP screens as completed product behavior.

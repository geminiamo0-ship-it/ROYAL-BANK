# ROYAL-BANK

ROYAL-BANK is a Next.js + Supabase question-bank and exam platform. The hardened core covers authentication, bank access, question selection, exam sessions, answer finalization, persistent flags, free-trial quotas, and previous-session behavior.

## Stack

- Next.js 16.3.3
- React 19.2.8
- TypeScript
- Supabase / PostgreSQL
- Tailwind CSS

## Local setup

Install dependencies:

```bash
npm ci
```

Create `.env.local` with the required variables:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

`SUPABASE_SERVICE_ROLE_KEY` is server-only and must never be exposed to browser code.

Start the application:

```bash
npm run dev
```

## Application verification

Run the complete application check:

```bash
npm run verify
```

This runs lint, TypeScript checking, and a production build.

## Database development

The canonical database history is `supabase/migrations/`.

With the Supabase CLI installed, rebuild and test the database locally with:

```bash
supabase db start
supabase db reset
supabase test db
```

The same sequence is enforced by `.github/workflows/verify-db.yml` for Supabase changes.

## Core contracts

- [Business rules](docs/BUSINESS_RULES.md)
- [Access model](docs/ACCESS_MODEL.md)
- [Database trust boundaries](docs/DATABASE_BOUNDARIES.md)
- [Core regression matrix](docs/CORE_TEST_MATRIX.md)

## Important invariants

- Each question belongs to exactly one bank.
- Exam blocks contain at most 70 questions.
- Standard/Tutor answers are final after Submit.
- Timed answers remain editable until End Block; unanswered questions become Incorrect on completion.
- Deleting an incomplete session deletes its session-scoped answers and locks, returning those questions to New when no other surviving state exists.
- Deleting a trial session never refunds consumed trial quota.
- Premium access can be global, pathway-scoped, or bank-scoped and may be time-bounded.

## Development scope

The Question Bank, exam flow, previous sessions, and their access/state infrastructure are the hardened core. Other areas of the product may still contain work-in-progress or placeholder functionality and should not be treated as production-complete solely because they render in the UI.

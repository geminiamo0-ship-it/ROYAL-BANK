# Migration Squash Required Before Merge

The `007+` SQL files on this audit branch are an exploratory hardening sequence, not the final production migration history. They intentionally capture discovered invariants and superseding fixes while auditing.

Do **not** merge this sequence as-is.

Before merge:

1. Run/validate the intended final schema on a disposable Supabase database.
2. Consolidate the hardening changes into a small, ordered pre-production migration set (or a clean baseline, since there is no important user data).
3. Re-run from an empty database.
4. Run security/business regression tests.
5. Only then merge the application integration + clean migrations.

This avoids carrying audit-time patch layering into production—the exact vibe-coding debt this pass is meant to remove.

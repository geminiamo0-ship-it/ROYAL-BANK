# Disposable Database Verification

Before merge, run the clean/squashed migration baseline against an empty Supabase project/database. Verify schema creation, RLS policies, function grants, triggers, materialized view refresh, trial configuration/quota, answer finalization, session deletion, and access tests. Because there is no important production user data, prefer a clean reproducible baseline over preserving accidental migration history.

# Core Security Hardening

This branch adds the first database/application security baseline without redesigning the UI.

Key changes:

- `/admin` is server-role-gated to active admins.
- `/support` is server-role-gated to active support/admin users.
- Signup metadata can no longer choose an authorization role.
- Direct profile mutation of role/subscription/account status is removed; controlled RPCs are provided.
- Premium question content, mappings, options, answer history, notes, concepts, flags, sessions, and locked session rows are access-gated.
- Free-trial access is configurable per bank and has a database-enforced lifetime block quota with a non-refundable usage ledger.
- Answer correctness is derived from the selected option in the database.
- Standard/Tutor answers are immutable after submit; timed answers remain mutable until End Block.
- Correct/Incorrect state follows the latest finalized answer.
- Flag state is persistent per user/question until manual unflag.
- Suspended state is unique per question and excluded from New.
- Session deletion releases unanswered locks; trial consumption is retained.
- Access-sensitive changes have audit tables.
- Shared category/topic counts are bank-aware and materialized for fast reads.

Important: these migrations must be exercised against a disposable Supabase database before merging. The project has no real user data yet, which is the correct time to normalize the schema and verify migration ordering.

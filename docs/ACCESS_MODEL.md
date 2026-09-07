# Access Model

## Authoritative sources

- `profiles.role`: staff authorization (`student`, `support`, `admin`).
- `profiles.is_active`: account-level kill switch. Inactive accounts cannot use protected resources even if a grant still exists.
- `profiles.subscription_tier`: account/UI summary only; it is not authoritative content authorization.
- `user_access_grants`: canonical premium-access grants.
- `question_banks.is_free_trial`: per-bank trial switch.
- `question_banks.free_trial_block_limit`: lifetime trial-block quota per user for that bank.
- `question_banks.free_trial_question_limit`: maximum questions allowed in one trial block, capped at 70.
- `free_trial_block_usage`: non-refundable trial-consumption ledger.

## Premium scopes

`user_access_grants.scope_type` supports:

- `global`: access to all banks.
- `pathway`: access to all current and future banks in that pathway.
- `bank`: access only to the selected bank.

A grant becomes active at `starts_at`. `expires_at = NULL` means lifetime access.

## Authorization helpers

- `can_access_question_bank(bank_id)`: canonical current-access decision for using a bank.
- `has_premium_question_bank_access(bank_id)`: canonical premium decision used by session creation and trial quota logic for the authenticated user.
- `is_active_user()`: canonical account-status decision.

The catalog/dashboard must derive unlock state from these server-side decisions. `subscription_tier`, static catalog flags, route visibility, and client-side UI state are not authorization boundaries.

## Expiry and owned history

Grant expiry removes current bank authorization. It prevents starting a new block and prevents resuming/updating an unfinished block that requires current bank access.

Expiry does **not** erase or hide the active user's owned historical records. The user may still read their own session metadata, stored answers, notes, saved concepts, and flags. Those history reads are ownership-based and do not restore access to the bank's current question content.

An unfinished owned session may still be deleted after expiry to release its locks. Completed sessions remain immutable history and cannot be deleted through the student path.

## Trial access

Trial access and premium access are separate concepts. A pathway may contain zero, one, or multiple trial banks; changing trial configuration is data/configuration, not a hard-coded application rule.

Exhausting the free-trial block quota prevents creation of another trial block. It does not retroactively delete owned history. Deleting a consumed trial session does not refund quota.

Legacy `user_pathway_access` data is retained only for compatibility/backfill during the hardening transition and must not be treated as the canonical authorization source for new code.

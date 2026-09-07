# Access Model

## Authoritative sources

- `profiles.role`: staff authorization (`student`, `support`, `admin`).
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

- `can_access_question_bank(bank_id)`: canonical decision for reading/using a bank.
- `has_premium_question_bank_access(user_id, bank_id)`: canonical premium decision used by session creation and trial quota logic.

Trial access and premium access are separate concepts. A pathway may contain zero, one, or multiple trial banks; changing trial configuration is data/configuration, not a hard-coded application rule.

Legacy `user_pathway_access` data is retained only for compatibility/backfill during the hardening transition and must not be treated as the canonical authorization source for new code.

# Access Model

- `profiles.role`: staff authorization (`student`, `support`, `admin`).
- `profiles.subscription_tier`: account/UI summary, not authoritative content authorization.
- `user_pathway_access`: authoritative premium pathway grant with expiry.
- `question_banks.is_free_trial`: per-bank trial switch.
- `question_banks.free_trial_block_limit`: per-user lifetime trial block quota.
- `free_trial_block_usage`: immutable quota-consumption ledger.
- `can_access_question_bank(bank_id)`: authoritative question-content read decision.

A pathway may have zero, one, or multiple trial banks. Changing the trial bank is data/configuration, not an application code change.

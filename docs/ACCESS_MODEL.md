# Access Model

## Authoritative sources

- `profiles.role`: staff authorization (`student`, `support`, `admin`).
- `profiles.is_active`: account-level kill switch. Inactive accounts cannot use protected resources even if a grant still exists.
- `profiles.subscription_tier`: account/UI summary only; it is not authoritative content authorization.
- `user_access_grants`: the **only** premium-access grant source.
- `question_banks.is_free_trial`: per-bank trial switch.
- `question_banks.free_trial_block_limit`: lifetime trial-block quota per user for that bank.
- `question_banks.free_trial_question_limit`: maximum questions allowed in one trial block, capped at 70.
- `question_banks.free_trial_article_limit`: lifetime unique-library-article quota for a non-premium user in that bank.
- `free_trial_block_usage`: non-refundable question-block trial-consumption ledger.
- `private.library_article_disclosures`: immutable unique article-disclosure ledger used for library trial enforcement.

## Premium scopes

`user_access_grants.scope_type` supports:

- `global`: access to all banks and every library mapped to those banks.
- `pathway`: access to all current and future banks in that pathway, including each bank's mapped library.
- `bank`: access only to the selected bank and that bank's mapped library.

A user may hold multiple `bank` grants at the same time. For example, a pathway with three banks can grant Bank 1 + Bank 2 while Bank 3 remains locked.

A grant becomes active at `starts_at`. `expires_at = NULL` means lifetime access.

`user_pathway_access` is removed. There is no second entitlement system or compatibility fallback for premium access.

## Bank-owned library model

Library entitlement follows the bank entitlement. The mapping table `question_bank_library_articles` connects article content to one or more banks.

Premium access to a bank means full access to both:

- the bank's question content; and
- every library article mapped to that bank.

Trial access is configured independently per bank. A typical bank can expose, for example:

- 4 lifetime question blocks, up to 70 questions per block; and
- 10 lifetime unique library articles.

Reopening the same disclosed article does not consume another library-trial slot. Parallel first-time opens are serialized database-side so the unique-article quota cannot be exceeded through concurrent requests.

Student article bodies are not directly readable from `library_articles`. They must be retrieved through the disclosure-aware library RPC, which applies premium or trial authorization before returning content.

## Authorization helpers

- `can_access_question_bank(bank_id)`: canonical current-access decision for using a bank.
- `has_premium_question_bank_access(bank_id)`: canonical premium decision sourced only from `user_access_grants` (plus staff override).
- `can_access_library_article(bank_id, article_id)`: checks whether the current user may open a mapped article without consuming a new disclosure.
- `list_library_articles(bank_id)`: returns bank library metadata and current trial state without article bodies.
- `get_library_article(bank_id, article_id)`: returns article content and atomically records a first-time trial disclosure when required.
- `is_active_user()`: canonical account-status decision.

The catalog/dashboard must derive unlock state from these server-side decisions. `subscription_tier`, static catalog flags, route visibility, and client-side UI state are not authorization boundaries.

## Expiry and owned history

Grant expiry removes current bank authorization. It prevents starting a new block and prevents resuming/updating an unfinished block that requires current bank access. It also removes full premium access to that bank's library.

Expiry does **not** erase or hide the active user's owned historical records. The user may still read their own session metadata, stored answers, notes, saved concepts, and flags. Those history reads are ownership-based and do not restore access to the bank's current question content.

An unfinished owned session may still be deleted after expiry to release its locks. Completed sessions remain immutable history and cannot be deleted through the student path.

## Trial access

Trial access and premium access are separate concepts. A pathway may contain zero, one, or multiple trial banks; changing trial configuration is data/configuration, not a hard-coded application rule.

Exhausting the free-trial block quota prevents creation of another trial block. Deleting a consumed trial session does not refund quota.

Exhausting the free-trial article quota prevents disclosure of another new article in that bank. Articles already disclosed to that user remain recognized as previously disclosed and reopening them does not consume additional quota.

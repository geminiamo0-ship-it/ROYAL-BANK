# Access Model

## Authoritative sources

- `profiles.role`: staff authorization (`student`, `support`, `admin`).
- `profiles.is_active`: account-level kill switch. Inactive accounts cannot use protected resources even if a grant still exists.
- `profiles.subscription_tier`: legacy display/account summary only. It is not authoritative content authorization and admin entitlement flows do not mutate it.
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

A customer may hold multiple independent active grants at the same time. For example, they may own several banks in one pathway, banks from different pathways, full pathway grants, and narrower historical or still-active grants alongside a broader grant.

Coverage is hierarchical. `global` covers every pathway and bank. A `pathway` grant covers every bank in that pathway. A bank grant covers only that bank. Exact or broader active coverage prevents a redundant purchase of the same already-covered product.

If a customer has active bank coverage for **every bank that currently belongs to a pathway**, the pathway is treated as activated through aggregate bank coverage. This aggregate activation reflects the current catalog only; unlike a real `pathway` grant it does not promise automatic access to a future bank added later. If a new uncovered bank is added, aggregate pathway activation becomes incomplete until that bank is covered or a real pathway/global grant exists.

A grant becomes active at `starts_at`. `expires_at = NULL` means lifetime access. A finite exact grant may be extended; extension updates that exact authoritative grant instead of inserting a duplicate exact grant.

`user_pathway_access` is removed. There is no second entitlement system or compatibility fallback for premium access.

Staff roles are administrative authorization only. `support` and `admin` do not receive premium bank content merely because of their role; a real active `user_access_grants` row is still required for premium content access. Staff-only operational RPCs continue to authorize through role checks independently of premium content grants.

The raw `grant_user_access(...)` primitive is internal to audited SECURITY DEFINER business wrappers. Browser/authenticated callers, including Support JWTs, do not have direct EXECUTE permission on it. Support activation must pass through request, order, confirmed payment, and `support_activate_upgrade`. Admin manual overrides use dedicated audited admin RPCs.

## Commercial subscription rules

- Multiple independent products may be held at the same time: Bank A + Bank B, banks from different pathways, multiple pathways, or broader All Royal access.
- Multiple open requests may exist for different catalog products; the same product still has at most one open request and request creation is serialized per user + product.
- A different uncovered bank remains purchasable even when other bank subscriptions are active.
- A full pathway remains purchasable while only some of its banks are covered.
- All Royal remains purchasable above narrower bank/pathway access.
- An exact finite grant exposes extension mode. A lifetime exact grant cannot be repurchased.
- A bank already covered by its pathway or by All Royal cannot be purchased again.
- A pathway already covered by All Royal cannot be purchased again.
- When every current bank in a pathway is independently covered by active bank grants, that pathway is shown as activated and a redundant full-pathway purchase is blocked.
- Payment transaction references are required for new manually confirmed payments, normalized case-insensitively, unique, and safe to retry idempotently only when the order/payment details match.
- `profiles.subscription_tier` never creates, extends, revokes, or proves entitlement.

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
- `has_premium_question_bank_access(bank_id)`: canonical premium decision sourced only from active, non-revoked `user_access_grants`.
- `can_access_library_article(bank_id, article_id)`: checks whether the current user may open a mapped article without consuming a new disclosure.
- `list_library_articles(bank_id)`: returns bank library metadata and current trial state without article bodies.
- `get_library_article(bank_id, article_id)`: returns article content and atomically records a first-time trial disclosure when required.
- `resolve_my_access(...)`: resolves exact, real broader, or aggregate all-bank pathway coverage for catalog/UI decisions.
- `is_active_user()`: canonical account-status decision.

The catalog/dashboard must derive unlock state from these server-side decisions. `subscription_tier`, static catalog flags, route visibility, and client-side UI state are not authorization boundaries.

## Expiry and owned history

Grant expiry removes the access provided by that grant. Other still-active grants continue to authorize the scopes they cover. Expiry prevents starting a new block or resuming/updating an unfinished block unless another active entitlement still covers that bank.

Expiry does **not** erase or hide the active user's owned historical records. The user may still read their own session metadata, stored answers, notes, saved concepts, and flags. Those history reads are ownership-based and do not restore access to the bank's current question content.

An unfinished owned session may still be deleted after expiry to release its locks. Completed sessions remain immutable history and cannot be deleted through the student path.

## Trial access

Trial access and premium access are separate concepts. A pathway may contain zero, one, or multiple trial banks; changing trial configuration is data/configuration, not a hard-coded application rule.

Exhausting the free-trial block quota prevents creation of another trial block. Deleting a consumed trial session does not refund quota.

Exhausting the free-trial article quota prevents disclosure of another new article in that bank. Articles already disclosed to that user remain recognized as previously disclosed and reopening them does not consume additional quota.

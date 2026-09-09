# Royal business activation core

## Sources of truth

Royal deliberately keeps business state separate from entitlement state:

- `upgrade_requests` records customer intent and the support workflow.
- `orders` records the commercial agreement (scope, duration, agreed price, currency).
- `payments` records money confirmed manually by Support.
- `promo_codes` records attribution, customer discount rules, and internal commission rules.
- `commissions` records one frozen commission result per successfully activated order.
- `user_access_grants` remains the **only** premium entitlement authority.
- `admin_audit_logs` records sensitive Support/Admin business actions.

A promo, request, order, or payment never grants premium access by itself.

## Release A workflow

1. An authenticated, active student opens `/upgrade`.
2. The student chooses Bank, Pathway, or Global access and may enter a promo code.
3. `create_upgrade_request` creates (or returns the existing open) request and a short `RY-XXXXXXXX` public Request ID.
4. The student is told to contact Royal Support on Telegram and send the Request ID. Support can ask the registered email as a secondary confirmation.
5. Support opens `/support`, searches the Request ID/email/name, and marks the request contacted.
6. Support records the agreed duration, internal/base price, customer discount, final agreed price, and currency.
7. After verifying payment externally (for example InstaPay), Support records the confirmed payment manually.
8. Activation remains disabled until confirmed payments cover the final agreed price.
9. `support_activate_upgrade` atomically creates the `user_access_grants` row, marks the request/order activated, writes the audit event, and creates the frozen promo commission when applicable.
10. Repeated activation is idempotent and returns the existing grant rather than creating a second entitlement.

## Promo privacy

Promo ownership does not create an Admin/Support role and does not expose finance or customer information. The later promo-owner view will expose only the promo code and successful activation count. Commission and revenue remain internal business data.

## Telegram configuration

Configure one of these server environment variables in the deployment:

- `ROYAL_SUPPORT_TELEGRAM_URL` — full `https://t.me/...` support URL, preferred.
- `ROYAL_SUPPORT_TELEGRAM_USERNAME` — Telegram username without or with the leading `@`.

No support handle is hardcoded. If neither setting is present, Royal still creates the Request ID but does not invent a Telegram destination.

## Security invariants

- Business tables have RLS enabled and no direct `anon`/`authenticated` table privileges.
- Browser code never creates a Supabase client; UI mutations call server actions, which invoke guarded database RPCs with the user's cookie-backed server session.
- Support RPCs independently require an active `support` or `admin` profile.
- User request creation independently requires an active authenticated profile.
- Promo commission settings are never returned by the Support detail RPC.
- Commission rules are snapshotted onto the order before payment so later promo-rule changes cannot rewrite historical sales.

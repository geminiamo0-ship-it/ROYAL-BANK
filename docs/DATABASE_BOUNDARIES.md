# Database Trust Boundaries

Trusted operations/RPCs introduced by the hardening pass:

- `can_access_question_bank` / `can_access_question`: authorization helpers
- `submit_exam_answer`: mode-aware answer persistence
- `complete_exam_session`: End Block finalization
- `set_question_flag`: persistent flag mutation
- `get_user_question_states`: canonical state read
- `update_my_profile`: safe self-service profile fields
- `admin_update_user_access`: admin-only role/account changes
- `grant_user_pathway_access`: support/admin subscription grants
- `admin_configure_bank_access`: admin-only trial-bank configuration

Direct client writes to authorization/content/locked-question structures are intentionally restricted. Service-role credentials remain a server-only trusted boundary.

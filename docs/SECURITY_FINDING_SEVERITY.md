# Security Finding Severity

- **Critical/High:** self-profile privilege escalation risk; signup role injection; premium question content readable to any authenticated user; privileged route trees lacked role authorization; arbitrary-user SECURITY DEFINER analytics.
- **High:** answer/session relationship and correctness trust; hard-coded trial authorization without authoritative quota enforcement.
- **Medium:** SECURITY DEFINER search-path/grant hygiene; active-account enforcement; access auditability; bank-aware count RPC hardening.

Severity reflects pre-production impact potential, not evidence of exploitation. No real production users are currently present.

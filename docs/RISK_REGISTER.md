# Current Core Risk Register

## Must resolve before merge

- Existing `create_exam_session` SQL body has not yet been fully verified against the new trusted-session contract.
- Application actions still use legacy answer/state/access paths until integrated.
- Exploratory audit migrations are intentionally layered and must be squashed after disposable-DB verification.
- Build/lint/typecheck have not yet been run against the branch through a local checkout/CI.

## Must resolve before production

- Complete remaining WIP pages/features.
- Define production retention/privacy policy for audit/login/trial usage data.
- Add production monitoring/error reporting and deployment rollback checks.
- Perform final security and production-readiness audit.

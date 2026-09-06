# Do Not Merge Yet

This branch contains active audit/hardening work and is intentionally **not merge-ready**.

Required gates before merge:

- application integration with new RPC/state/access contracts
- create_exam_session SQL verification
- disposable Supabase migration run
- migration squash/cleanup
- build, lint, TypeScript checks
- security/business regression tests
- core-flow smoke test

`main` remains untouched until these gates pass.

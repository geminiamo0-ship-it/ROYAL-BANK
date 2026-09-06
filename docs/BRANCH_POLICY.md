# Branch Policy for Core Hardening

`main` stays unchanged while audit/refactor work is validated. `audit/core-hardening` is a working branch and currently not merge-ready. After application integration and tests, squash the exploratory database migration chain into a clean baseline, review the final diff, open a PR, and merge only after the gates in `DO_NOT_MERGE_YET.md` pass.

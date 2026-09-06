# Dead-Code Cleanup Plan

Do not delete files by suspicious filename alone. Prove they are not referenced by package scripts, imports, deployment, ingestion, or documentation first.

Candidates visible at repository root include `fix.js`, `fix_ui.js`, `rewrite.js`, `scratch.js`, `check_rpc.js`, `implementation_plan.html`, and old/test helpers. Ingestion scripts under `scripts/` are not assumed dead because they may be operational tooling.

Once proven unused, delete rather than moving to an `old/` or `backup/` folder; Git history is the archive.

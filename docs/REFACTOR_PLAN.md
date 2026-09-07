# Core Refactor Plan

Refactor only after security/business behavior is protected.

- Split `src/actions/exam.ts` by session creation/loading, answers, flags/notes, completion, and previous-session operations.
- Move shared DTO/types out of Server Action modules to remove circular coupling.
- Replace duplicated category fallback constants with one source of truth; prefer DB-derived bank counts.
- Replace JS-side user question-state aggregation with canonical database RPC.
- Split the large Question Bank client into state/controller and presentational sections without visual redesign.
- Keep WIP Progress/Performance/Results/Admin feature implementation out of this pass except security/shared infrastructure.

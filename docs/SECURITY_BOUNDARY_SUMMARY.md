# Security Boundary Summary

Frontend visibility/disabled buttons are UX only. Server route guards protect privileged pages. Server Actions/RPCs authenticate and validate intent. RLS protects rows/content from direct API access. Database triggers/constraints protect invariants such as ownership, answer correctness, finalization, and trial quota. Service role remains server-only and trusted.

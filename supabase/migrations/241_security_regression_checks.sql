-- Regression expectations for integration tests:
-- 1. student cannot read premium question content
-- 2. student cannot self-promote role/subscription/is_active
-- 3. user A cannot read/write user B session/answers/notes/flags
-- 4. free trial cannot exceed configured block quota, including concurrent creates
-- 5. answer correctness cannot be forged
-- 6. Standard/Tutor submitted answer cannot change
-- 7. Timed answer can change before End Block, not after
-- 8. admin/support route trees are server-role-gated
SELECT 1;

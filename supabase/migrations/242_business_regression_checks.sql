-- Regression expectations for integration tests:
-- 1. New excludes answered and Suspended
-- 2. deleting unfinished session releases unanswered locks to New
-- 3. latest correct answer removes question from Incorrect
-- 4. persistent Flag survives across sessions until manual unflag
-- 5. duplicate unfinished locks count Suspended once
-- 6. resume uses same locked question set
-- 7. End Block score denominator is full locked block size
-- 8. block size never exceeds 70
SELECT 1;

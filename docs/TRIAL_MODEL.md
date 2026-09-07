# Free-Trial Model

Trial access is configured per question bank, not by hard-coded ID.

Each trial bank has `free_trial_block_limit`. Creating a trial session consumes one lifetime block in `free_trial_block_usage`. The database serializes quota checks per user/bank to prevent concurrent bypass. Deleting/terminating a session does not refund consumption.

Premium pathway grants bypass trial quota for banks in that pathway while the grant is active.

The migration currently preserves legacy behavior by marking Bank 1 as trial when no trial bank exists and defaults its limit to 4. Admin configuration can change this later without application code changes.

# Create timeout budget change

Production synchronized Create testing on the Free Supabase tier showed all 150 requests reached the Create RPC while BFF upstream wait frequently exceeded the current 6.5 second cap. The Create RPC is idempotent by request ID, so the gateway can safely allow a larger Create-only wait budget without changing the timeout policy for other exam actions.

This note accompanies the Create-only timeout-budget change and can be removed or folded into the performance baseline after the 150-user validation run.

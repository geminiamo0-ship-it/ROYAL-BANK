# Redis Decision

No Redis/Upstash integration is added in this pass yet. First integrate canonical Postgres RPCs, remove unnecessary round trips/JS aggregation, use the existing/new indexes, and benchmark completed core flows. Add Redis only if measured shared/static reads still justify another cache/invalidation layer.

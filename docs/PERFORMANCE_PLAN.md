# Core Performance Plan

Measure before adding Redis.

Core flows to benchmark after correctness integration:

- Question Bank initial load
- Question state/count refresh
- Start Exam / question locking
- Exam resume/load
- Submit/modify answer
- Previous Sessions list
- Delete/terminate session

For each flow record DB round trips, rows returned, server duration, and client-visible latency. First optimize indexes, query shape, RPC aggregation, and payload size. Consider Redis only for measured shared/static read bottlenecks after Postgres/Next optimization.

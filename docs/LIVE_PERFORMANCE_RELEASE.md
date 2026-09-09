# Live Performance & Completed Session Review

This release moves performance into the bank home and replaces placeholder analytics with live per-user metrics.

- Bank home uses a single performance RPC for answered/correct/incorrect, completion, activity, streak, difficulty mix, category breakdown, empirical peer benchmark, and Estimated Percentile.
- Percentile is explicitly an estimate. It uses the stored correct-option percentage as the peer probability, applies 0.9/1.0/1.1 difficulty weights, shrinks the z-score for small samples, and maps it through a logistic CDF.
- Questions without an empirical percentage still count toward answered/correct/incorrect but are excluded from benchmark/percentile estimation.
- Previous Sessions exposes Resume/Delete only for incomplete sessions and Review only for completed sessions.
- Completed review is read-only and reuses the windowed exam UI, showing the historical answer, correct answer, explanation, and option percentages.
- Completed review actions remain behind the Royal exam gateway.
- The retired `/performance` page redirects to the bank home.

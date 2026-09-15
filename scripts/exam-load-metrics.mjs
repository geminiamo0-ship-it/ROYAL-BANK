import { setTimeout as sleep } from 'node:timers/promises';

export function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

export function summarize(rows) {
  return {
    requests: rows.length,
    successful: rows.filter(r => r.ok === true).length,
    errors: rows.filter(r => r.ok !== true).length,
    p50_ms: percentile(rows.map(r => r.ms), 0.5),
    p95_ms: percentile(rows.map(r => r.ms), 0.95),
    max_ms: rows.length ? Math.max(...rows.map(r => r.ms)) : null,
  };
}

// Open-loop schedule: slow responses do not silently lower the offered rate.
// Stop scheduling on error/latency/overlap; drain in-flight requests before cleanup.
export async function runStage({ rate, durationSeconds, send, users, maxLatencyMs = 5000,
  maxP95Ms = 2500, maxInflight = 20, maxLaunchLagMs = 200 }) {
  if (!(rate > 0 && rate <= 10 && durationSeconds > 0 && durationSeconds <= 60)) {
    throw new Error('Stage exceeds bounded load envelope');
  }
  const expected = Math.floor(rate * durationSeconds);
  const rows = [], pending = new Set(), busy = new Set();
  const start = performance.now();
  let stopReason = null;
  for (let i = 0; i < expected; i++) {
    if (stopReason) break;
    const due = start + i * 1000 / rate;
    await sleep(Math.max(0, due - performance.now()));
    if (stopReason) break;
    const lag = performance.now() - due;
    if (lag > maxLaunchLagMs || pending.size >= maxInflight) {
      stopReason = lag > maxLaunchLagMs ? 'generator_launch_lag' : 'inflight_limit';
      break;
    }
    const user = i % users;
    if (busy.has(user)) { stopReason = 'user_overlap'; break; }
    busy.add(user);
    const task = Promise.resolve().then(() => send(i, user)).then(row => {
      rows.push({ ...row, launch_lag_ms: +lag.toFixed(1) });
      if (!row.ok) stopReason ||= 'request_failed';
      if (row.ms > maxLatencyMs) stopReason ||= 'latency_limit';
      if (rows.length >= 10 && percentile(rows.map(r => r.ms), 0.95) > maxP95Ms) {
        stopReason ||= 'p95_limit';
      }
    }).catch(() => { stopReason ||= 'generator_exception'; }).finally(() => {
      busy.delete(user); pending.delete(task);
    });
    pending.add(task);
  }
  await Promise.all(pending);
  if (!stopReason) await sleep(Math.max(0, start + durationSeconds * 1000 - performance.now()));
  const elapsedMs = performance.now() - start;
  const summary = summarize(rows);
  if (rows.length !== expected) stopReason ||= 'incomplete_stage';
  if (summary.errors) stopReason ||= 'request_failed';
  if (summary.p95_ms > maxP95Ms) stopReason ||= 'p95_limit';
  return {
    offered_rps: rate, duration_seconds: durationSeconds, expected_requests: expected,
    elapsed_ms: +elapsedMs.toFixed(1),
    // Includes the full scheduled window and any response drain beyond that window.
    successful_rps: +(summary.successful / Math.max(durationSeconds, elapsedMs / 1000)).toFixed(2),
    ...summary, passed: stopReason === null, stop_reason: stopReason, rows,
  };
}

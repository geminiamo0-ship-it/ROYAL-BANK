import fs from 'node:fs';
import crypto from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const target = process.env.TARGET_URL;
if (target !== 'https://royal-bank-nhr8.vercel.app') throw new Error('Unexpected Royal target');
const users = JSON.parse(fs.readFileSync('load-cookies.json', 'utf8'));
const rate = 17;
const durationSeconds = 60;
const expected = rate * durationSeconds;
if (users.length < 340) throw new Error(`Need at least 340 isolated users, got ${users.length}`);

const scenarios = ['all', 'new_only', 'filtered'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rows = [];
const pending = new Set();
const busy = new Set();
let stopReason = null;

const argsFor = scenario => ({
  p_request_id: crypto.randomUUID(),
  p_bank_id: 1,
  p_session_type: 'standard',
  p_limit: 40,
  p_difficulties: scenario === 'filtered' ? ['1'] : [],
  p_categories: [],
  p_topics: [],
  p_question_selection: scenario === 'filtered' ? 'all' : scenario,
});

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function parseServerTiming(value) {
  const out = {};
  if (!value) return out;
  for (const part of value.split(',')) {
    const m = part.trim().match(/^([^;]+)(?:;.*?dur=([0-9.]+))?/i);
    if (m && m[2] != null) out[m[1].trim()] = Number(m[2]);
  }
  return out;
}

async function createExam(user, scenario) {
  const start = performance.now();
  try {
    const response = await fetch(`${target}/api/exam`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/json',
        cookie: user.cookie,
        'user-agent': 'RoyalBank-Authorized-1000pm-Load/20260915',
      },
      body: JSON.stringify({ action: 'create', args: argsFor(scenario) }),
      signal: AbortSignal.timeout(10000),
    });
    const raw = await response.text();
    let json = null;
    try { json = JSON.parse(raw); } catch {}
    const valid = uuid.test(json?.session?.id || '')
      && typeof json?.window_access_token === 'string'
      && json.window_access_token.length > 0
      && Array.isArray(json?.questions)
      && json.questions.length > 0;
    return {
      scenario,
      status: response.status,
      ok: response.status === 200 && json != null && !json.error && valid,
      ms: +(performance.now() - start).toFixed(1),
      timing: parseServerTiming(response.headers.get('server-timing')),
      error: json?.error?.code || null,
    };
  } catch (error) {
    return { scenario, status: 0, ok: false, ms: +(performance.now() - start).toFixed(1), timing: {}, error: error.name };
  }
}

const start = performance.now();
for (let i = 0; i < expected; i += 1) {
  if (stopReason) break;
  const due = start + i * 1000 / rate;
  await sleep(Math.max(0, due - performance.now()));
  const lag = performance.now() - due;
  if (lag > 250) { stopReason = 'generator_launch_lag'; break; }
  if (pending.size >= 80) { stopReason = 'inflight_limit'; break; }
  const userIndex = i % 340;
  if (busy.has(userIndex)) { stopReason = 'user_overlap'; break; }
  busy.add(userIndex);
  const scenario = scenarios[i % scenarios.length];
  const task = createExam(users[userIndex], scenario).then(row => {
    rows.push({ ...row, launch_lag_ms: +lag.toFixed(1) });
    if (!row.ok && rows.length >= 50) {
      const errors = rows.filter(r => !r.ok).length;
      if (errors / rows.length > 0.02) stopReason ||= 'error_rate_limit';
    }
    if (row.ms > 5000) stopReason ||= 'latency_limit';
    if (rows.length >= 50 && percentile(rows.map(r => r.ms), 0.95) > 3000) stopReason ||= 'p95_limit';
  }).catch(() => { stopReason ||= 'generator_exception'; }).finally(() => {
    busy.delete(userIndex);
    pending.delete(task);
  });
  pending.add(task);
}
await Promise.all(pending);

const elapsedMs = performance.now() - start;
const successful = rows.filter(r => r.ok).length;
const errors = rows.length - successful;
const statusCounts = Object.fromEntries([...new Set(rows.map(r => r.status))].sort((a,b)=>a-b).map(s => [String(s), rows.filter(r => r.status === s).length]));
const timingNames = [...new Set(rows.flatMap(r => Object.keys(r.timing || {})))];
const timingSummary = Object.fromEntries(timingNames.map(name => {
  const vals = rows.map(r => r.timing?.[name]).filter(v => Number.isFinite(v));
  return [name, { samples: vals.length, p50_ms: percentile(vals, 0.5), p95_ms: percentile(vals, 0.95), max_ms: vals.length ? Math.max(...vals) : null }];
}));
const byScenario = Object.fromEntries(scenarios.map(s => {
  const rs = rows.filter(r => r.scenario === s);
  return [s, { requests: rs.length, successful: rs.filter(r=>r.ok).length, errors: rs.filter(r=>!r.ok).length, p50_ms: percentile(rs.map(r=>r.ms),0.5), p95_ms: percentile(rs.map(r=>r.ms),0.95), max_ms: rs.length ? Math.max(...rs.map(r=>r.ms)) : null }];
}));

if (rows.length !== expected) stopReason ||= 'incomplete_stage';
if (errors / Math.max(1, rows.length) > 0.02) stopReason ||= 'error_rate_limit';
const p95 = percentile(rows.map(r => r.ms), 0.95);
if (p95 > 3000) stopReason ||= 'p95_limit';

const report = {
  target,
  at: new Date().toISOString(),
  offered_rps: rate,
  duration_seconds: durationSeconds,
  expected_requests: expected,
  requests: rows.length,
  successful,
  errors,
  success_rate: +(successful / Math.max(1, rows.length) * 100).toFixed(3),
  successful_rps: +(successful / Math.max(durationSeconds, elapsedMs / 1000)).toFixed(2),
  elapsed_ms: +elapsedMs.toFixed(1),
  p50_ms: percentile(rows.map(r=>r.ms), 0.5),
  p95_ms: p95,
  p99_ms: percentile(rows.map(r=>r.ms), 0.99),
  max_ms: rows.length ? Math.max(...rows.map(r=>r.ms)) : null,
  status_counts: statusCounts,
  timing: timingSummary,
  by_scenario: byScenario,
  passed: stopReason === null,
  stop_reason: stopReason,
};
fs.writeFileSync('exam-load-1000pm-results.json', JSON.stringify(report, null, 2));
console.log('EXAM_LOAD_1000PM_SUMMARY ' + JSON.stringify(report));
if (!report.passed) process.exitCode = 1;

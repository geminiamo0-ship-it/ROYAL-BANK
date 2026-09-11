import fs from 'node:fs';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

const target = (process.env.TARGET_URL || '').replace(/\/$/, '');
if (!target) throw new Error('TARGET_URL is required.');
const users = JSON.parse(fs.readFileSync('load-cookies.json', 'utf8'));

function percentile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return Number(sorted[Math.max(0, index)].toFixed(2));
}

function parseServerTiming(value) {
  if (!value) return {};
  const out = {};
  for (const part of value.split(',')) {
    const [rawName, ...params] = part.trim().split(';');
    if (!rawName) continue;
    const dur = params.map((p) => p.trim()).find((p) => p.startsWith('dur='));
    if (!dur) continue;
    const n = Number(dur.slice(4));
    if (Number.isFinite(n)) out[rawName] = n;
  }
  return out;
}

function stats(values) {
  const clean = values.filter(Number.isFinite);
  return {
    count: clean.length,
    p50_ms: percentile(clean, 0.5),
    p95_ms: percentile(clean, 0.95),
    max_ms: clean.length ? Number(Math.max(...clean).toFixed(2)) : null,
  };
}

async function create(account) {
  const start = performance.now();
  try {
    const res = await fetch(target + '/api/exam', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/json',
        cookie: account.cookie,
        'user-agent': 'RoyalBank-Authorized-LoadTest/CreateProbe-1.0',
      },
      body: JSON.stringify({
        action: 'create',
        args: {
          p_request_id: crypto.randomUUID(),
          p_bank_id: 1,
          p_session_type: 'standard',
          p_limit: 10,
          p_difficulties: [],
          p_categories: [],
          p_topics: [],
          p_question_selection: 'all',
        },
      }),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return {
      email: account.email,
      status: res.status,
      ms: performance.now() - start,
      serverTimingRaw: res.headers.get('server-timing') || '',
      serverTiming: parseServerTiming(res.headers.get('server-timing') || ''),
      requestId: res.headers.get('x-royal-request-id') || '',
      sessionId: json?.session?.id || '',
      detail: res.status === 200 ? '' : text.slice(0, 300),
    };
  } catch (error) {
    return {
      email: account.email,
      status: 0,
      ms: performance.now() - start,
      serverTimingRaw: '',
      serverTiming: {},
      requestId: '',
      sessionId: '',
      detail: String(error),
    };
  }
}

console.log(`Starting CREATE_PROBE with ${users.length} simultaneous authenticated users.`);
const rows = await Promise.all(users.map(create));
const buckets = {};
for (const row of rows) buckets[row.status] = (buckets[row.status] || 0) + 1;
const success = rows.filter((r) => r.status === 200 && r.sessionId);
const timeout = rows.filter((r) => r.status === 504);
const metricNames = [...new Set(success.flatMap((r) => Object.keys(r.serverTiming)))];
const timingSummary = Object.fromEntries(
  metricNames.map((name) => [name, stats(success.map((r) => r.serverTiming[name]))]),
);

console.log('CREATE_PROBE ' + JSON.stringify({
  total: rows.length,
  success: success.length,
  timeout504: timeout.length,
  buckets,
  total_latency: stats(rows.map((r) => r.ms)),
  success_latency: stats(success.map((r) => r.ms)),
  timeout_latency: stats(timeout.map((r) => r.ms)),
  server_timing_present: success.filter((r) => r.serverTimingRaw).length,
  server_timing: timingSummary,
}));

for (const row of rows.filter((r) => r.status !== 200)) {
  console.log(`CREATE_FAILURE ${row.email} status=${row.status} ms=${row.ms.toFixed(2)} request_id=${row.requestId || '-'} detail=${JSON.stringify(row.detail)}`);
}
for (const row of success.slice(0, 5)) {
  console.log(`CREATE_TIMING_SAMPLE ${row.email} ms=${row.ms.toFixed(2)} request_id=${row.requestId || '-'} server_timing=${JSON.stringify(row.serverTimingRaw || '-')}`);
}

if (success.length !== rows.length) process.exitCode = 2;

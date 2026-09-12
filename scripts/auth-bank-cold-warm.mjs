import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

const target = (process.env.TARGET_URL || '').replace(/\/$/, '');
if (!target) throw new Error('TARGET_URL is required.');

const users = JSON.parse(fs.readFileSync('load-cookies.json', 'utf8'));
const concurrency = Number(process.env.BANK_COLD_WARM_USERS || 75);
const idleBeforeFirstMs = Number(process.env.BANK_COLD_IDLE_MS || 60000);
const warmGapMs = Number(process.env.BANK_WARM_GAP_MS || 1000);
const selected = users.slice(0, concurrency);

if (selected.length !== concurrency) {
  throw new Error(`Expected ${concurrency} prepared users, found ${selected.length}.`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return Number(sorted[Math.max(0, index)].toFixed(2));
}

async function timedFetch(account) {
  const start = performance.now();
  try {
    const res = await fetch(target + '/bank/1', {
      headers: {
        cookie: account.cookie,
        'user-agent': 'RoyalBank-Authorized-LoadTest/3.0',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    await res.arrayBuffer();
    return {
      email: account.email,
      status: res.status,
      location: res.headers.get('location') || '',
      ms: performance.now() - start,
      error: null,
    };
  } catch (error) {
    return {
      email: account.email,
      status: 0,
      location: '',
      ms: performance.now() - start,
      error: String(error),
    };
  }
}

async function burst(label) {
  const wallStart = performance.now();
  const results = await Promise.all(selected.map(timedFetch));
  const wallMs = performance.now() - wallStart;
  const buckets = {};
  for (const row of results) {
    const key = `${row.status} ${row.location || '-'}`;
    buckets[key] = (buckets[key] || 0) + 1;
  }

  const summary = {
    label,
    total: results.length,
    ok200: results.filter((r) => r.status === 200).length,
    p50_ms: percentile(results.map((r) => r.ms), 0.5),
    p95_ms: percentile(results.map((r) => r.ms), 0.95),
    max_ms: Number(Math.max(...results.map((r) => r.ms)).toFixed(2)),
    wall_ms: Number(wallMs.toFixed(2)),
    buckets,
  };
  console.log('BANK_COLD_WARM ' + JSON.stringify(summary));

  for (const row of results.filter((r) => r.status !== 200)) {
    console.log(`BANK_NON200 ${label} ${row.email} status=${row.status} location=${row.location || '-'} ms=${row.ms.toFixed(2)} error=${JSON.stringify(row.error || '')}`);
  }

  return { summary, results };
}

console.log(`Preparing cold/warm comparison with ${concurrency} users against ${target}.`);
console.log(`Idling ${idleBeforeFirstMs}ms before the first burst to reduce carry-over from prior traffic.`);
await sleep(idleBeforeFirstMs);

const first = await burst('first_after_idle');
console.log(`Waiting ${warmGapMs}ms before immediate repeat.`);
await sleep(warmGapMs);
const warm = await burst('immediate_warm_repeat');

const ratio = first.summary.p95_ms && warm.summary.p95_ms
  ? Number((first.summary.p95_ms / warm.summary.p95_ms).toFixed(2))
  : null;
console.log('BANK_COLD_WARM_COMPARISON ' + JSON.stringify({
  first_p95_ms: first.summary.p95_ms,
  warm_p95_ms: warm.summary.p95_ms,
  p95_first_to_warm_ratio: ratio,
  p50_delta_ms: first.summary.p50_ms !== null && warm.summary.p50_ms !== null
    ? Number((first.summary.p50_ms - warm.summary.p50_ms).toFixed(2))
    : null,
  p95_delta_ms: first.summary.p95_ms !== null && warm.summary.p95_ms !== null
    ? Number((first.summary.p95_ms - warm.summary.p95_ms).toFixed(2))
    : null,
}));

if (first.results.some((r) => r.status !== 200) || warm.results.some((r) => r.status !== 200)) {
  process.exitCode = 2;
}

import fs from 'node:fs';
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

async function timedFetch(url, init) {
  const start = performance.now();
  try {
    const res = await fetch(url, init);
    await res.arrayBuffer();
    return { res, ms: performance.now() - start, error: null };
  } catch (error) {
    return { res: null, ms: performance.now() - start, error: String(error) };
  }
}

console.log(`Starting bank-only diagnostic with ${users.length} concurrent authenticated users against ${target}.`);
const results = await Promise.all(users.map(async (account) => {
  const out = await timedFetch(target + '/bank/1', {
    headers: {
      cookie: account.cookie,
      'user-agent': 'RoyalBank-Authorized-LoadTest/3.0',
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  });
  return {
    email: account.email,
    status: out.res?.status || 0,
    location: out.res?.headers.get('location') || '',
    ms: out.ms,
    error: out.error,
  };
}));

const buckets = {};
for (const row of results) {
  const key = `${row.status} ${row.location || '-'}`;
  buckets[key] = (buckets[key] || 0) + 1;
}

console.log('BANK_ONLY_DIAGNOSTIC ' + JSON.stringify({
  total: results.length,
  ok200: results.filter((r) => r.status === 200).length,
  p50_ms: percentile(results.map((r) => r.ms), 0.5),
  p95_ms: percentile(results.map((r) => r.ms), 0.95),
  max_ms: Number(Math.max(...results.map((r) => r.ms)).toFixed(2)),
  buckets,
}));

for (const row of results.filter((r) => r.status !== 200)) {
  console.log(`BANK_NON200 ${row.email} status=${row.status} location=${row.location || '-'} ms=${row.ms.toFixed(2)} error=${JSON.stringify(row.error || '')}`);
}

if (results.some((r) => r.status !== 200)) process.exitCode = 2;

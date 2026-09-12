import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

const target = (process.env.TARGET_URL || '').replace(/\/$/, '');
if (!target) throw new Error('TARGET_URL is required.');

const allUsers = JSON.parse(fs.readFileSync('load-cookies.json', 'utf8'));
const phases = (process.env.BANK_RAMP_PHASES || '1,10,25,50,75')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);
const cooldownMs = Number(process.env.BANK_RAMP_COOLDOWN_MS || 15000);

if (!phases.length) throw new Error('BANK_RAMP_PHASES must contain at least one positive integer.');
if (Math.max(...phases) > allUsers.length) {
  throw new Error(`Ramp requires ${Math.max(...phases)} users but only ${allUsers.length} were prepared.`);
}

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let hadFailure = false;

console.log(`Starting bank-only ramp ${phases.join(' -> ')} against ${target}.`);

for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex += 1) {
  const concurrency = phases[phaseIndex];
  const users = allUsers.slice(0, concurrency);
  const phaseStart = performance.now();

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

  const summary = {
    concurrency,
    total: results.length,
    ok200: results.filter((r) => r.status === 200).length,
    p50_ms: percentile(results.map((r) => r.ms), 0.5),
    p95_ms: percentile(results.map((r) => r.ms), 0.95),
    max_ms: Number(Math.max(...results.map((r) => r.ms)).toFixed(2)),
    wall_ms: Number((performance.now() - phaseStart).toFixed(2)),
    buckets,
  };

  console.log('BANK_RAMP_PHASE ' + JSON.stringify(summary));

  for (const row of results.filter((r) => r.status !== 200)) {
    console.log(`BANK_RAMP_NON200 concurrency=${concurrency} ${row.email} status=${row.status} location=${row.location || '-'} ms=${row.ms.toFixed(2)} error=${JSON.stringify(row.error || '')}`);
  }

  if (results.some((r) => r.status !== 200)) hadFailure = true;

  if (phaseIndex < phases.length - 1 && cooldownMs > 0) {
    console.log(`Cooling down for ${cooldownMs}ms before next phase.`);
    await sleep(cooldownMs);
  }
}

if (hadFailure) process.exitCode = 2;

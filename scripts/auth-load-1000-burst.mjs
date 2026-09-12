import fs from 'node:fs';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

const target = (process.env.TARGET_URL || '').replace(/\/$/, '');
const shard = String(process.env.LOAD_SHARD || '0');
const barrierMs = Number(process.env.BARRIER_MS || 0);
const users = JSON.parse(fs.readFileSync('load-cookies.json', 'utf8'));
if (!target || !Number.isFinite(barrierMs) || barrierMs <= 0) throw new Error('Missing target/barrier configuration.');
if (!Array.isArray(users) || users.length !== 100) throw new Error(`Shard ${shard}: expected 100 users, got ${users?.length || 0}.`);

function percentile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return Number(sorted[i].toFixed(1));
}

async function hit(account) {
  const started = performance.now();
  try {
    const res = await fetch(`${target}/api/exam`, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
      headers: {
        cookie: account.cookie,
        'content-type': 'application/json',
        'user-agent': 'RoyalBank-Authorized-LoadTest/1000',
      },
      body: JSON.stringify({
        action: 'create',
        args: {
          p_request_id: crypto.randomUUID(),
          p_bank_id: 1,
          p_session_type: 'standard',
          p_limit: 40,
          p_difficulties: [],
          p_categories: [],
          p_topics: [],
          p_question_selection: 'all',
        },
      }),
    });
    const text = await res.text();
    let validSession = false;
    if (res.status === 200) {
      try {
        const json = JSON.parse(text);
        validSession = Boolean(json?.session?.id && json?.window_access_token);
      } catch {}
    }
    return {
      status: res.status,
      ms: performance.now() - started,
      bytes: Buffer.byteLength(text),
      valid_session: validSession,
      sample: res.status === 200 ? '' : text.slice(0, 220),
    };
  } catch (error) {
    return { status: 0, ms: performance.now() - started, bytes: 0, valid_session: false, sample: String(error?.message || error) };
  }
}

const delay = Math.max(0, barrierMs - Date.now());
console.log(`Shard ${shard} ready with ${users.length} users; barrier=${new Date(barrierMs).toISOString()} delay_ms=${delay}.`);
if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

const wallStart = performance.now();
const firedAt = Date.now();
const results = await Promise.all(users.map(hit));
const wallMs = performance.now() - wallStart;
const lat = results.map((r) => r.ms).filter(Number.isFinite);
const counts = {};
for (const r of results) counts[String(r.status || 'network')] = (counts[String(r.status || 'network')] || 0) + 1;
const errors = results.filter((r) => r.status === 0 || r.status >= 500).length;
const rateLimited = results.filter((r) => r.status === 429).length;
const valid = results.filter((r) => r.status === 200 && r.valid_session).length;
const summary = {
  shard: Number(shard),
  target,
  planned_barrier_ms: barrierMs,
  fired_at_ms: firedAt,
  barrier_skew_ms: firedAt - barrierMs,
  requests: results.length,
  success_200: results.filter((r) => r.status === 200).length,
  valid_sessions: valid,
  network_or_5xx: errors,
  rate_limited_429: rateLimited,
  status_counts: counts,
  wall_ms: Number(wallMs.toFixed(1)),
  throughput_rps: Number((results.length / (wallMs / 1000)).toFixed(2)),
  p50_ms: percentile(lat, 0.50),
  p95_ms: percentile(lat, 0.95),
  p99_ms: percentile(lat, 0.99),
  max_ms: lat.length ? Number(Math.max(...lat).toFixed(1)) : null,
  total_response_mb: Number((results.reduce((s, r) => s + r.bytes, 0) / 1024 / 1024).toFixed(2)),
  sample_errors: [...new Set(results.map((r) => r.sample).filter(Boolean))].slice(0, 5),
};
fs.writeFileSync(`load-1000-shard-${shard}.json`, JSON.stringify(summary, null, 2));
console.log('BURST_RESULT ' + JSON.stringify(summary));

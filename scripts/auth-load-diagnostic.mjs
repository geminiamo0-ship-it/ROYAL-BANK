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

async function timedFetch(url, init) {
  const start = performance.now();
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    return { res, text, ms: performance.now() - start, error: null };
  } catch (error) {
    return { res: null, text: '', ms: performance.now() - start, error: String(error) };
  }
}

async function gateway(cookie, action, args, token) {
  const headers = { 'content-type': 'application/json', cookie, 'user-agent': 'RoyalBank-Authorized-LoadTest/3.0' };
  if (token) headers['x-royal-window-access'] = token;
  const out = await timedFetch(target + '/api/exam', {
    method: 'POST', headers, body: JSON.stringify({ action, args }), redirect: 'manual',
  });
  let json = null;
  try { json = JSON.parse(out.text); } catch {}
  return { ...out, json };
}

console.log(`Starting middleware diagnostic with ${users.length} concurrent authenticated users.`);
const bankResults = await Promise.all(users.map(async (account) => {
  const out = await timedFetch(target + '/bank/1', {
    headers: { cookie: account.cookie, 'user-agent': 'RoyalBank-Authorized-LoadTest/3.0' },
    redirect: 'manual',
  });
  return {
    email: account.email,
    status: out.res?.status || 0,
    location: out.res?.headers.get('location') || '',
    ms: out.ms,
    error: out.error,
  };
}));

const bankBuckets = {};
for (const row of bankResults) {
  const key = `${row.status} ${row.location || '-'}`;
  bankBuckets[key] = (bankBuckets[key] || 0) + 1;
}
console.log('BANK_DIAGNOSTIC ' + JSON.stringify({
  total: bankResults.length,
  ok200: bankResults.filter((r) => r.status === 200).length,
  p50_ms: percentile(bankResults.map((r) => r.ms), 0.5),
  p95_ms: percentile(bankResults.map((r) => r.ms), 0.95),
  max_ms: Number(Math.max(...bankResults.map((r) => r.ms)).toFixed(2)),
  buckets: bankBuckets,
}));
for (const row of bankResults.filter((r) => r.status !== 200)) {
  console.log(`BANK_NON200 ${row.email} status=${row.status} location=${row.location || '-'} ms=${row.ms.toFixed(2)}`);
}

await new Promise((resolve) => setTimeout(resolve, 5000));
console.log(`Starting direct exam-core diagnostic with ${users.length} concurrent authenticated users.`);

const coreResults = await Promise.all(users.map(async (account) => {
  const result = { email: account.email, ok: false, failedStep: null, statuses: {}, timings: {} };

  const create = await gateway(account.cookie, 'create', {
    p_request_id: crypto.randomUUID(),
    p_bank_id: 1,
    p_session_type: 'standard',
    p_limit: 10,
    p_difficulties: [],
    p_categories: [],
    p_topics: [],
    p_question_selection: 'all',
  });
  result.statuses.create = create.res?.status || 0;
  result.timings.create = create.ms;
  const session = create.json?.session;
  const token = create.json?.window_access_token;
  if (create.res?.status !== 200 || !session?.id || !token) {
    result.failedStep = 'create';
    result.detail = create.text.slice(0, 300);
    return result;
  }

  const w0 = await gateway(account.cookie, 'window', { p_session_id: session.id, p_start: 0, p_count: 3 }, token);
  result.statuses.window0 = w0.res?.status || 0;
  result.timings.window0 = w0.ms;
  if (w0.res?.status !== 200 || !Array.isArray(w0.json) || !w0.json.length) {
    result.failedStep = 'window0';
    result.detail = w0.text.slice(0, 300);
    return result;
  }

  const w3 = await gateway(account.cookie, 'window', { p_session_id: session.id, p_start: 3, p_count: 3 }, token);
  result.statuses.window3 = w3.res?.status || 0;
  result.timings.window3 = w3.ms;
  if (w3.res?.status !== 200) {
    result.failedStep = 'window3';
    result.detail = w3.text.slice(0, 300);
    return result;
  }

  const q = w0.json[0];
  const option = q?.options?.[0];
  if (!q?.id || !option?.id) {
    result.failedStep = 'question-shape';
    return result;
  }

  const submit = await gateway(account.cookie, 'submit', {
    p_request_id: crypto.randomUUID(),
    p_session_id: session.id,
    p_question_id: Number(q.id),
    p_selected_option_id: Number(option.id),
    p_time_spent_seconds: 8,
  });
  result.statuses.submit = submit.res?.status || 0;
  result.timings.submit = submit.ms;
  if (submit.res?.status !== 200 || Number(submit.json?.answer?.question_id) !== Number(q.id)) {
    result.failedStep = 'submit';
    result.detail = submit.text.slice(0, 300);
    return result;
  }

  const complete = await gateway(account.cookie, 'complete', { p_session_id: session.id });
  result.statuses.complete = complete.res?.status || 0;
  result.timings.complete = complete.ms;
  if (complete.res?.status !== 200) {
    result.failedStep = 'complete';
    result.detail = complete.text.slice(0, 300);
    return result;
  }

  result.ok = true;
  return result;
}));

function stepStats(step) {
  const values = coreResults.map((r) => r.timings[step]).filter((v) => Number.isFinite(v));
  return { count: values.length, p50_ms: percentile(values, 0.5), p95_ms: percentile(values, 0.95), max_ms: values.length ? Number(Math.max(...values).toFixed(2)) : null };
}

const failures = {};
for (const row of coreResults.filter((r) => !r.ok)) failures[row.failedStep || 'unknown'] = (failures[row.failedStep || 'unknown'] || 0) + 1;
console.log('CORE_DIAGNOSTIC ' + JSON.stringify({
  total: coreResults.length,
  ok: coreResults.filter((r) => r.ok).length,
  failures,
  create: stepStats('create'),
  window0: stepStats('window0'),
  window3: stepStats('window3'),
  submit: stepStats('submit'),
  complete: stepStats('complete'),
}));
for (const row of coreResults.filter((r) => !r.ok)) {
  console.log(`CORE_FAILURE ${row.email} step=${row.failedStep} statuses=${JSON.stringify(row.statuses)} detail=${JSON.stringify(row.detail || '')}`);
}

if (coreResults.some((r) => !r.ok)) process.exitCode = 2;

import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const EXPECTED_SUPABASE = 'https://trnvsgenmzhyuayxxdoq.supabase.co';
const EXPECTED_APP = 'https://royal-bank-opal.vercel.app';
const PUBLISHABLE_KEY = 'sb_publishable_p3T4sz4VpnWVuhjFgT1kwQ_b3mWaoO9';

const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const adminKey = process.env.SUPABASE_SECRET_KEY_PRODUCTION || '';
const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
const userCount = boundedInt('LOAD_USER_COUNT', 50, 1, 250);
const questionCount = boundedInt('LOAD_QUESTION_COUNT', 40, 1, 40);
const setupConcurrency = boundedInt('LOAD_SETUP_CONCURRENCY', 1, 1, 10);
const setupPacingMs = boundedInt('LOAD_SETUP_PACING_MS', 1600, 0, 10000);
const syncTimeoutMs = boundedInt('LOAD_SYNC_TIMEOUT_MS', 60000, 5000, 120000);

if (supabaseUrl !== EXPECTED_SUPABASE) throw new Error(`Refusing load test: unexpected Supabase URL ${supabaseUrl}`);
if (appUrl !== EXPECTED_APP) throw new Error(`Refusing load test: unexpected app URL ${appUrl}`);
if (!adminKey || !adminKey.startsWith('sb_secret_')) throw new Error('Missing or invalid SUPABASE_SECRET_KEY_PRODUCTION');

const runId = String(process.env.GITHUB_RUN_ID || Date.now()).replace(/\D/g, '').slice(-12) || String(Date.now());
const metrics = new Map();
const createdUsers = [];
const failures = [];
let syncVerified = false;

function boundedInt(name, fallback, min, max) {
  const raw = process.env[name];
  const value = raw == null || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function adminHeaders(json = true) {
  return {
    apikey: adminKey,
    accept: 'application/json',
    ...(json ? { 'content-type': 'application/json' } : {}),
    'user-agent': 'royal-bank-production-edge-load/1.0',
  };
}

function publicHeaders(json = true) {
  return {
    apikey: PUBLISHABLE_KEY,
    accept: 'application/json',
    ...(json ? { 'content-type': 'application/json' } : {}),
    'user-agent': 'royal-bank-production-edge-load/1.0',
  };
}

async function readBody(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

async function expectOk(response, label) {
  const body = await readBody(response);
  if (!response.ok) {
    const detail = typeof body === 'string' ? body.slice(0, 500) : JSON.stringify(body).slice(0, 500);
    throw new Error(`${label} failed (${response.status}): ${detail}`);
  }
  return body;
}
async function fetchJsonWithRetry(url, init, label) {
  let last = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(url, init);
    const body = await readBody(response);
    if (response.ok) return body;
    const detail = typeof body === 'string' ? body : JSON.stringify(body);
    const retryable =
      response.status === 429 ||
      (response.status === 401 && detail.includes('JWT issued at future'));
    if (!retryable) {
      throw new Error(`${label} failed (${response.status}): ${detail.slice(0, 500)}`);
    }
    last = new Error(`${label} failed (${response.status}): ${detail.slice(0, 500)}`);
    const waitMs = Math.min(30000, 1500 * (2 ** attempt));
    console.log(`${label} transiently failed (${response.status}); retrying in ${waitMs}ms.`);
    await sleep(waitMs);
  }
  throw last || new Error(`${label} failed after retries`);
}

async function setupUser(index) {
  const email = `royal-edge-load-${runId}-${String(index).padStart(3, '0')}-${randomUUID().slice(0, 8)}@load.invalid`;
  const password = `Load!${randomUUID()}Aa1`;
  const created = await fetchJsonWithRetry(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: 'Royal Production Edge Load' } }),
  }, `create user ${index}`);
  const userId = created?.id || created?.user?.id;
  if (!userId) throw new Error(`create user ${index} returned no id`);
  createdUsers.push({ userId, email, password, token: null, sessionId: null });

  const profileUrl = new URL(`${supabaseUrl}/rest/v1/profiles`);
  profileUrl.searchParams.set('id', `eq.${userId}`);
  await fetchJsonWithRetry(profileUrl, {
    method: 'PATCH',
    headers: { ...adminHeaders(), prefer: 'return=minimal' },
    body: JSON.stringify({ is_active: true, role: 'student' }),
  }, `activate profile ${index}`);

  await fetchJsonWithRetry(`${supabaseUrl}/rest/v1/user_access_grants`, {
    method: 'POST',
    headers: { ...adminHeaders(), prefer: 'return=minimal' },
    body: JSON.stringify({
      user_id: userId,
      scope_type: 'bank',
      question_bank_id: 1,
      starts_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    }),
  }, `grant bank access ${index}`);

  const signedIn = await fetchJsonWithRetry(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: publicHeaders(),
    body: JSON.stringify({ email, password }),
  }, `sign in ${index}`);
  if (!signedIn?.access_token) throw new Error(`sign in ${index} returned no access token`);
  const user = createdUsers.find((item) => item.userId === userId);
  user.token = signedIn.access_token;
  return user;
}

async function mapLimit(items, limit, fn) {
  let cursor = 0;
  const results = new Array(items.length);
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const current = cursor++;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
      if (setupPacingMs) await sleep(setupPacingMs);
    }
  });
  await Promise.all(workers);
  return results;
}

function recordMetric(action, entry) {
  const list = metrics.get(action) || [];
  list.push(entry);
  metrics.set(action, list);
}

function parseServerTiming(value) {
  const out = {};
  if (!value) return out;
  for (const part of value.split(',')) {
    const match = part.trim().match(/^([A-Za-z0-9_-]+)(?:;dur=([0-9.]+))?/);
    if (!match || match[2] == null) continue;
    const duration = Number(match[2]);
    if (Number.isFinite(duration) && duration >= 0) out[match[1]] = duration;
  }
  return out;
}

async function exam(user, action, args) {
  const startedEpochMs = Date.now();
  const started = performance.now();
  let response;
  try {
    response = await fetch(`${appUrl}/api/exam?__royal_edge_canary=smoke`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${user.token}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': 'royal-bank-production-edge-load/1.0',
      },
      body: JSON.stringify({ action, args }),
    });
  } catch (error) {
    const ms = Math.round((performance.now() - started) * 100) / 100;
    recordMetric(action, { ms, status: 'network_error', ok: false, started_epoch_ms: startedEpochMs, ended_epoch_ms: Date.now() });
    throw error;
  }

  const ms = Math.round((performance.now() - started) * 100) / 100;
  const proxy = response.headers.get('x-royal-proxy');
  const gateway = response.headers.get('x-royal-gateway');
  const serverTiming = parseServerTiming(response.headers.get('server-timing'));
  recordMetric(action, {
    ms,
    status: response.status,
    ok: response.ok && proxy === 'cloudflare-edge',
    proxy,
    gateway,
    server_timing_ms: serverTiming,
    started_epoch_ms: startedEpochMs,
    ended_epoch_ms: Date.now(),
  });
  const body = await readBody(response);
  if (proxy !== 'cloudflare-edge') throw new Error(`${action} did not route through Cloudflare (status ${response.status}, proxy ${proxy}): ${JSON.stringify(body).slice(0, 400)}`);
  if (!response.ok) throw new Error(`${action} failed (${response.status}): ${JSON.stringify(body).slice(0, 500)}`);
  return body;
}

async function runUser(user, index) {
  const prepared = await exam(user, 'prepare', { p_bank_id: 1 });
  if (prepared?.prepared !== true) throw new Error(`user ${index}: prepare did not confirm access`);

  const created = await exam(user, 'create', {
    p_request_id: randomUUID(),
    p_bank_id: 1,
    p_session_type: 'standard',
    p_limit: questionCount,
    p_difficulties: [],
    p_categories: [],
    p_topics: [],
    p_question_selection: 'all',
  });
  const sessionId = created?.session?.id;
  const ids = Array.isArray(created?.question_ids) ? created.question_ids : [];
  if (!sessionId || ids.length !== questionCount) throw new Error(`user ${index}: invalid create response (ids=${ids.length})`);
  user.sessionId = sessionId;

  const questions = Array.isArray(created?.questions) ? [...created.questions] : [];
  while (questions.length < ids.length) {
    const start = questions.length;
    const count = Math.min(3, ids.length - start);
    const windowed = await exam(user, 'window', { p_session_id: sessionId, p_start: start, p_count: count });
    if (!Array.isArray(windowed) || windowed.length !== count) throw new Error(`user ${index}: window ${start}+${count} returned ${Array.isArray(windowed) ? windowed.length : 'non-array'}`);
    questions.push(...windowed);
  }

  for (let i = 0; i < questions.length; i += 1) {
    const question = questions[i];
    const optionId = question?.options?.[0]?.id;
    if (!question?.id || !optionId) throw new Error(`user ${index}: question ${i} missing id/options`);
    await exam(user, 'submit', {
      p_request_id: randomUUID(),
      p_session_id: sessionId,
      p_question_id: Number(question.id),
      p_selected_option_id: Number(optionId),
      p_time_spent_seconds: 1,
    });
    if (i === 0) {
      await exam(user, 'flag', { p_question_id: Number(question.id), p_flagged: true });
      await exam(user, 'suspend', { p_session_id: sessionId });
      await exam(user, 'resume', { p_session_id: sessionId });
    }
  }

  const completed = await exam(user, 'complete', { p_session_id: sessionId });
  const completedOk = completed?.ok === true || completed?.completed === true || completed?.status === 'completed' || completed?.is_completed === true || typeof completed?.completed_at === 'string';
  if (!completedOk) throw new Error(`user ${index}: complete did not confirm completion`);
  return { userId: user.userId, sessionId };
}

function inFilter(ids) {
  return `in.(${ids.join(',')})`;
}

async function getJson(url, label) {
  return expectOk(await fetch(url, { headers: adminHeaders(false) }), label);
}

async function syncState(users) {
  const ids = users.map((user) => user.userId);
  const filter = inFilter(ids);
  const sessionsUrl = new URL(`${supabaseUrl}/rest/v1/edge_exam_sessions`);
  sessionsUrl.searchParams.set('select', 'user_id,session_id,completed_at,total_questions,version');
  sessionsUrl.searchParams.set('user_id', filter);

  const pendingUrl = new URL(`${supabaseUrl}/rest/v1/edge_exam_sync_inbox`);
  pendingUrl.searchParams.set('select', 'event_id,user_id,event_type');
  pendingUrl.searchParams.set('user_id', filter);
  pendingUrl.searchParams.set('processed_at', 'is.null');

  const errorsUrl = new URL(`${supabaseUrl}/rest/v1/edge_exam_sync_inbox`);
  errorsUrl.searchParams.set('select', 'event_id,user_id,event_type,last_error');
  errorsUrl.searchParams.set('user_id', filter);
  errorsUrl.searchParams.set('last_error', 'not.is.null');

  const [sessions, pending, errors] = await Promise.all([
    getJson(sessionsUrl, 'read materialized sessions'),
    getJson(pendingUrl, 'read pending inbox'),
    getJson(errorsUrl, 'read inbox errors'),
  ]);
  return { sessions, pending, errors };
}

async function waitForSync(users, completedAtMs) {
  const deadline = Date.now() + syncTimeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await syncState(users);
    const sessions = Array.isArray(last.sessions) ? last.sessions : [];
    const completedUsers = new Set(sessions.filter((row) => row?.completed_at && Number(row?.total_questions) === questionCount).map((row) => String(row.user_id)));
    const pending = Array.isArray(last.pending) ? last.pending : [];
    const errors = Array.isArray(last.errors) ? last.errors : [];
    if (completedUsers.size === users.length && pending.length === 0 && errors.length === 0) {
      syncVerified = true;
      return { lag_ms: Date.now() - completedAtMs, sessions: sessions.length, pending: 0, errors: 0 };
    }
    await sleep(1500);
  }
  return {
    lag_ms: Date.now() - completedAtMs,
    sessions: Array.isArray(last?.sessions) ? last.sessions.length : null,
    pending: Array.isArray(last?.pending) ? last.pending.length : null,
    errors: Array.isArray(last?.errors) ? last.errors.length : null,
  };
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1));
  return Math.round(sorted[index] * 100) / 100;
}

function summarizeMetrics() {
  const out = {};
  for (const [action, entries] of metrics.entries()) {
    const latencies = entries.filter((entry) => Number.isFinite(entry.ms)).map((entry) => entry.ms);
    const statuses = {};
    for (const entry of entries) statuses[String(entry.status)] = (statuses[String(entry.status)] || 0) + 1;
    const timingNames = new Set(entries.flatMap((entry) => Object.keys(entry.server_timing_ms || {})));
    const serverTiming = {};
    for (const name of timingNames) {
      const values = entries
        .map((entry) => entry.server_timing_ms?.[name])
        .filter((value) => Number.isFinite(value));
      serverTiming[name] = {
        samples: values.length,
        p50_ms: percentile(values, 0.50),
        p95_ms: percentile(values, 0.95),
        p99_ms: percentile(values, 0.99),
        max_ms: values.length ? Math.round(Math.max(...values) * 100) / 100 : null,
      };
    }
    out[action] = {
      requests: entries.length,
      success: entries.filter((entry) => entry.ok).length,
      failures: entries.filter((entry) => !entry.ok).length,
      p50_ms: percentile(latencies, 0.50),
      p95_ms: percentile(latencies, 0.95),
      p99_ms: percentile(latencies, 0.99),
      max_ms: latencies.length ? Math.round(Math.max(...latencies) * 100) / 100 : null,
      statuses,
      server_timing_ms: serverTiming,
    };
  }
  const submits = metrics.get('submit') || [];
  const submitStarts = submits.map((entry) => entry.started_epoch_ms).filter(Number.isFinite);
  const submitEnds = submits.map((entry) => entry.ended_epoch_ms).filter(Number.isFinite);
  const spanMs = submitStarts.length && submitEnds.length ? Math.max(...submitEnds) - Math.min(...submitStarts) : 0;
  out.submit_throughput_rps = spanMs > 0 ? Math.round((submits.length / (spanMs / 1000)) * 100) / 100 : null;
  return out;
}

async function bulkDelete(table, ids) {
  if (!ids.length) return;
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
  url.searchParams.set('user_id', inFilter(ids));
  const response = await fetch(url, { method: 'DELETE', headers: { ...adminHeaders(false), prefer: 'return=minimal' } });
  if (!response.ok) throw new Error(`${table} cleanup returned ${response.status}: ${(await response.text()).slice(0, 250)}`);
}

async function cleanup() {
  const ids = createdUsers.map((user) => user.userId);
  if (!ids.length) return [];
  if (!syncVerified) await sleep(5000);
  const cleanupErrors = [];
  const tables = [
    'edge_exam_answers',
    'edge_exam_session_questions',
    'edge_exam_flags',
    'edge_user_question_state',
    'edge_user_bank_daily',
    'edge_exam_sessions',
    'edge_exam_sync_inbox',
    'user_access_grants',
  ];
  for (const table of tables) {
    try { await bulkDelete(table, ids); } catch (error) { cleanupErrors.push(`${table}: ${error?.message || error}`); }
  }
  await mapLimit(createdUsers, 5, async (user) => {
    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(user.userId)}`, { method: 'DELETE', headers: adminHeaders(false) });
      if (!response.ok) cleanupErrors.push(`auth ${user.userId}: ${response.status}`);
    } catch (error) {
      cleanupErrors.push(`auth ${user.userId}: ${error?.message || error}`);
    }
  });
  return cleanupErrors;
}

let summary;
try {
  console.log(`Preparing ${userCount} isolated authenticated load users...`);
  const users = await mapLimit(Array.from({ length: userCount }, (_, i) => i), setupConcurrency, (index) => setupUser(index));
  console.log(`Prepared ${users.length} users. Starting synchronized Edge lifecycle load: ${userCount} users x ${questionCount} questions.`);

  const loadStartedAt = Date.now();
  const settled = await Promise.allSettled(users.map((user, index) => runUser(user, index)));
  const loadCompletedAt = Date.now();
  settled.forEach((result, index) => {
    if (result.status === 'rejected') failures.push({ user_index: index, error: String(result.reason?.message || result.reason).slice(0, 800) });
  });

  const successfulUsers = settled.filter((result) => result.status === 'fulfilled').length;
  const sync = successfulUsers === users.length ? await waitForSync(users, loadCompletedAt) : { skipped: true };
  summary = {
    ok: failures.length === 0 && syncVerified,
    app: appUrl,
    users: userCount,
    questions_per_user: questionCount,
    successful_users: successfulUsers,
    failed_users: failures.length,
    wall_time_ms: loadCompletedAt - loadStartedAt,
    metrics: summarizeMetrics(),
    sync,
    failures,
  };
} catch (error) {
  failures.push({ stage: 'setup_or_runner', error: String(error?.message || error).slice(0, 1000) });
  summary = { ok: false, app: appUrl, users: userCount, questions_per_user: questionCount, metrics: summarizeMetrics(), failures };
} finally {
  const cleanupErrors = await cleanup();
  summary = { ...(summary || { ok: false }), cleanup_errors: cleanupErrors };
  if (cleanupErrors.length) summary.ok = false;
  await writeFile('edge-load-results.json', JSON.stringify(summary, null, 2));
  console.log(`PRODUCTION_EDGE_LOAD ${JSON.stringify(summary)}`);
  if (!summary.ok) process.exitCode = 1;
}

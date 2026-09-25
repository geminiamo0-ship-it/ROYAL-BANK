import { randomUUID } from 'node:crypto';

const EXPECTED_SUPABASE = 'https://trnvsgenmzhyuayxxdoq.supabase.co';
const EXPECTED_APP = 'https://royal-bank-five.vercel.app';
const PUBLISHABLE_KEY = 'sb_publishable_p3T4sz4VpnWVuhjFgT1kwQ_b3mWaoO9';

const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const adminKey = process.env.SUPABASE_SECRET_KEY_PRODUCTION || '';
const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
if (supabaseUrl !== EXPECTED_SUPABASE) throw new Error(`Refusing canary: unexpected Supabase URL ${supabaseUrl}`);
if (appUrl !== EXPECTED_APP) throw new Error(`Refusing canary: unexpected app URL ${appUrl}`);
if (!adminKey || !adminKey.startsWith('sb_secret_')) throw new Error('Missing or invalid SUPABASE_SECRET_KEY_PRODUCTION');

const run = String(process.env.GITHUB_RUN_ID || Date.now()).replace(/\D/g, '').slice(-12) || String(Date.now());
const email = `royal-edge-prod-canary-${run}-${Date.now()}@load.invalid`;
const password = `Canary!${randomUUID()}Aa1`;
let userId = null;
let token = null;
let sessionId = null;
let touchedEdge = false;
let syncVerified = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function adminHeaders(json = true) {
  return {
    apikey: adminKey,
    accept: 'application/json',
    ...(json ? { 'content-type': 'application/json' } : {}),
    'user-agent': 'royal-bank-production-vercel-canary/1.0',
  };
}

function publicHeaders(json = true) {
  return {
    apikey: PUBLISHABLE_KEY,
    accept: 'application/json',
    ...(json ? { 'content-type': 'application/json' } : {}),
    'user-agent': 'royal-bank-production-vercel-canary/1.0',
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

async function createUser() {
  const body = await expectOk(await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: 'Royal Production Edge Canary' } }),
  }), 'Admin create user');
  const id = body?.id || body?.user?.id;
  if (!id) throw new Error('Admin create user returned no id');
  return id;
}

async function patchProfile() {
  const url = new URL(`${supabaseUrl}/rest/v1/profiles`);
  url.searchParams.set('id', `eq.${userId}`);
  await expectOk(await fetch(url, {
    method: 'PATCH',
    headers: { ...adminHeaders(), prefer: 'return=minimal' },
    body: JSON.stringify({ is_active: true, role: 'student' }),
  }), 'Activate canary profile');
}

async function grantBankAccess() {
  await expectOk(await fetch(`${supabaseUrl}/rest/v1/user_access_grants`, {
    method: 'POST',
    headers: { ...adminHeaders(), prefer: 'return=minimal' },
    body: JSON.stringify({
      user_id: userId,
      scope_type: 'bank',
      question_bank_id: 1,
      starts_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }),
  }), 'Grant canary bank access');
}

async function signIn() {
  const body = await expectOk(await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: publicHeaders(),
    body: JSON.stringify({ email, password }),
  }), 'Canary sign-in');
  if (!body?.access_token) throw new Error('Canary sign-in returned no access token');
  return body.access_token;
}

async function observeDefaultRoute() {
  const response = await fetch(`${appUrl}/api/exam`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': 'royal-bank-production-vercel-canary/1.0',
    },
    body: JSON.stringify({ action: 'prepare', args: { p_bank_id: 1 } }),
  });
  const proxy = response.headers.get('x-royal-proxy');
  const body = await readBody(response);
  return {
    status: response.status,
    proxy: proxy || null,
    gateway: response.headers.get('x-royal-gateway'),
    body,
  };
}

async function exam(action, args) {
  touchedEdge = true;
  const started = performance.now();
  const response = await fetch(`${appUrl}/api/exam?__royal_edge_canary=smoke`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': 'royal-bank-production-vercel-canary/1.0',
    },
    body: JSON.stringify({ action, args }),
  });
  const proxy = response.headers.get('x-royal-proxy');
  const gateway = response.headers.get('x-royal-gateway');
  if (proxy !== 'cloudflare-edge') {
    const body = await readBody(response);
    throw new Error(`Canary ${action} did not route through Cloudflare (status ${response.status}, proxy ${proxy}): ${JSON.stringify(body).slice(0, 500)}`);
  }
  const body = await expectOk(response, `Canary ${action}`);
  return {
    body,
    proxy,
    gateway,
    ms: Math.round((performance.now() - started) * 100) / 100,
  };
}

async function getSyncRows() {
  const url = new URL(`${supabaseUrl}/rest/v1/edge_exam_sync_inbox`);
  url.searchParams.set('select', 'event_type,processed_at,last_error');
  url.searchParams.set('user_id', `eq.${userId}`);
  url.searchParams.set('order', 'received_at.asc');
  return expectOk(await fetch(url, { headers: adminHeaders(false) }), 'Read canary sync inbox');
}

async function getCompletedSession() {
  const url = new URL(`${supabaseUrl}/rest/v1/edge_exam_sessions`);
  url.searchParams.set('select', 'session_id,completed_at,total_questions,version');
  url.searchParams.set('user_id', `eq.${userId}`);
  url.searchParams.set('session_id', `eq.${sessionId}`);
  return expectOk(await fetch(url, { headers: adminHeaders(false) }), 'Read canary materialized session');
}

async function waitForSync() {
  const required = ['session.created', 'answer.finalized', 'question.flagged', 'session.suspended', 'session.resumed', 'session.completed'];
  const started = Date.now();
  const deadline = started + 45_000;
  while (Date.now() < deadline) {
    const rows = await getSyncRows();
    const types = Array.isArray(rows) ? rows.map((row) => String(row.event_type)) : [];
    const clean = Array.isArray(rows) && rows.every((row) => row.processed_at && !row.last_error);
    const materialized = await getCompletedSession();
    if (required.every((type) => types.includes(type)) && clean && Array.isArray(materialized) && materialized.length === 1 && materialized[0]?.completed_at) {
      syncVerified = true;
      return { types: [...new Set(types)].sort(), lag_ms: Date.now() - started, materialized: materialized[0] };
    }
    await sleep(1000);
  }
  const rows = await getSyncRows();
  throw new Error(`Async canary sync incomplete after 45s: ${JSON.stringify(rows).slice(0, 1000)}`);
}

async function deleteByUser(table) {
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
  url.searchParams.set('user_id', `eq.${userId}`);
  const response = await fetch(url, { method: 'DELETE', headers: { ...adminHeaders(false), prefer: 'return=minimal' } });
  if (!response.ok) throw new Error(`${table} cleanup returned ${response.status}: ${(await response.text()).slice(0, 250)}`);
}

async function cleanup() {
  if (!userId) return;
  if (touchedEdge && !syncVerified) await sleep(8000);
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
    try { await deleteByUser(table); } catch (error) { console.error(`Cleanup ${table}: ${error?.message || error}`); }
  }
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE', headers: adminHeaders(false),
    });
    if (!response.ok) console.error(`Auth cleanup returned ${response.status}: ${(await response.text()).slice(0, 250)}`);
  } catch (error) {
    console.error(`Auth cleanup failed: ${error?.message || error}`);
  }
}

try {
  userId = await createUser();
  await patchProfile();
  await grantBankAccess();
  token = await signIn();

  const control = await observeDefaultRoute();
  const latencies = {};
  const prepared = await exam('prepare', { p_bank_id: 1 });
  latencies.prepare_ms = prepared.ms;
  if (prepared.body?.prepared !== true) throw new Error(`Prepare did not confirm access: ${JSON.stringify(prepared.body).slice(0, 400)}`);

  const created = await exam('create', {
    p_request_id: randomUUID(),
    p_bank_id: 1,
    p_session_type: 'standard',
    p_limit: 4,
    p_difficulties: [],
    p_categories: [],
    p_topics: [],
    p_question_selection: 'all',
  });
  latencies.create_ms = created.ms;
  sessionId = created.body?.session?.id;
  const first = created.body?.questions?.[0];
  if (!sessionId || !first?.id || !first?.options?.[0]?.id || !Array.isArray(created.body?.question_ids) || created.body.question_ids.length !== 4) {
    throw new Error(`Invalid create response: ${JSON.stringify(created.body).slice(0, 600)}`);
  }

  const windowed = await exam('window', { p_session_id: sessionId, p_start: 1, p_count: 3 });
  latencies.window_ms = windowed.ms;
  if (!Array.isArray(windowed.body) || windowed.body.length !== 3) throw new Error('Window did not return the remaining 3 questions');
  const questions = [first, ...windowed.body];

  latencies.first_submit_ms = (await exam('submit', {
    p_request_id: randomUUID(), p_session_id: sessionId, p_question_id: Number(first.id),
    p_selected_option_id: Number(first.options[0].id), p_time_spent_seconds: 1,
  })).ms;

  latencies.flag_ms = (await exam('flag', { p_question_id: Number(first.id), p_flagged: true })).ms;
  latencies.suspend_ms = (await exam('suspend', { p_session_id: sessionId })).ms;
  latencies.resume_ms = (await exam('resume', { p_session_id: sessionId })).ms;

  const remainingSubmitMs = [];
  for (const question of questions.slice(1)) {
    const result = await exam('submit', {
      p_request_id: randomUUID(), p_session_id: sessionId, p_question_id: Number(question.id),
      p_selected_option_id: Number(question.options[0].id), p_time_spent_seconds: 1,
    });
    remainingSubmitMs.push(result.ms);
  }
  latencies.remaining_submit_ms = remainingSubmitMs;

  const completed = await exam('complete', { p_session_id: sessionId });
  latencies.complete_ms = completed.ms;
  const completedOk = completed.body?.ok === true || completed.body?.completed === true || completed.body?.status === 'completed' || completed.body?.is_completed === true || typeof completed.body?.completed_at === 'string';
  if (!completedOk) throw new Error(`Complete did not confirm completion: ${JSON.stringify(completed.body).slice(0, 500)}`);

  const sync = await waitForSync();
  console.log(`PRODUCTION_VERCEL_EDGE_CANARY ${JSON.stringify({
    ok: true,
    app: appUrl,
    control,
    proxy: prepared.proxy,
    gateway: prepared.gateway,
    question_count: questions.length,
    lifecycle: ['prepare','create','window','submit','flag','suspend','resume','submit','complete'],
    latencies,
    sync,
  })}`);
} finally {
  await cleanup();
}

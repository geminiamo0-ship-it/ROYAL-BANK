import { randomUUID } from 'node:crypto';

const EXPECTED_SUPABASE_URL = 'https://trnvsgenmzhyuayxxdoq.supabase.co';
const EXPECTED_WORKER_URL = 'https://royal-bank-exam-production.geminiamo0.workers.dev';
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const secret = process.env.SUPABASE_SECRET_KEY?.trim();
const workerUrl = (process.env.WORKER_URL || '').replace(/\/+$/, '');
if (supabaseUrl !== EXPECTED_SUPABASE_URL) throw new Error(`Refusing smoke: expected ${EXPECTED_SUPABASE_URL}`);
if (workerUrl !== EXPECTED_WORKER_URL) throw new Error(`Refusing smoke: expected ${EXPECTED_WORKER_URL}`);
if (!secret) throw new Error('Missing SUPABASE_SECRET_KEY');

const email = `edge-prod-smoke-${process.env.GITHUB_RUN_ID || Date.now()}-${Date.now()}@example.com`;
const password = `Smoke!${randomUUID()}Aa1`;
let userId = null;
let touchedWorker = false;
let syncVerified = false;

const supabaseHeaders = (json = true) => ({
  apikey: secret,
  ...(json ? { 'content-type': 'application/json' } : {}),
  accept: 'application/json',
  'user-agent': 'royal-bank-edge-production-smoke/1.0',
});

async function responseJson(response, label) {
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const detail = typeof body === 'string' ? body.slice(0, 500) : JSON.stringify(body).slice(0, 500);
    throw new Error(`${label} failed (${response.status}): ${detail}`);
  }
  return body;
}

async function adminCreateUser() {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'Edge Production Smoke' },
    }),
  });
  const body = await responseJson(response, 'Admin create user');
  const id = body?.id || body?.user?.id;
  if (!id) throw new Error('Admin create user returned no user id');
  return id;
}

async function signIn() {
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify({ email, password }),
  });
  const body = await responseJson(response, 'Password sign-in');
  if (!body?.access_token) throw new Error('Sign-in returned no access token');
  return body.access_token;
}

async function workerExam(token, action, args) {
  touchedWorker = true;
  const response = await fetch(`${workerUrl}/exam`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': 'royal-bank-edge-production-smoke/1.0',
    },
    body: JSON.stringify({ action, args }),
  });
  return responseJson(response, `Worker ${action}`);
}

async function fetchRows(table, params) {
  const query = new URL(`${supabaseUrl}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) query.searchParams.set(key, value);
  const response = await fetch(query, { headers: supabaseHeaders(false) });
  const rows = await responseJson(response, `Read ${table}`);
  return Array.isArray(rows) ? rows : [];
}

async function waitForSync(sessionId) {
  const required = ['session.created', 'answer.finalized', 'session.completed'];
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const inbox = await fetchRows('edge_exam_sync_inbox', {
      select: 'event_type',
      user_id: `eq.${userId}`,
    });
    const types = inbox.map((row) => String(row.event_type));
    const sessions = await fetchRows('edge_exam_sessions', {
      select: 'session_id,completed_at',
      user_id: `eq.${userId}`,
      session_id: `eq.${sessionId}`,
    });
    const materialized = sessions.some((row) => String(row.session_id) === String(sessionId) && row.completed_at);
    if (required.every((type) => types.includes(type)) && materialized) {
      syncVerified = true;
      return [...new Set(types)].sort();
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error('Async Queue -> Supabase materialization did not complete within 45 seconds.');
}

async function deleteRowsByUser(table) {
  const query = new URL(`${supabaseUrl}/rest/v1/${table}`);
  query.searchParams.set('user_id', `eq.${userId}`);
  const response = await fetch(query, {
    method: 'DELETE',
    headers: { ...supabaseHeaders(false), prefer: 'return=minimal' },
  });
  if (!response.ok) throw new Error(`${table} cleanup failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
}

async function cleanup() {
  if (!userId) return;
  if (touchedWorker && !syncVerified) await new Promise((resolve) => setTimeout(resolve, 8_000));
  for (const table of [
    'edge_exam_answers',
    'edge_exam_session_questions',
    'edge_exam_flags',
    'edge_exam_sessions',
    'edge_user_question_state',
    'edge_user_bank_daily',
    'edge_exam_sync_inbox',
  ]) {
    try { await deleteRowsByUser(table); }
    catch (error) { console.error(`Smoke ${table} cleanup failed:`, error?.message || error); }
  }
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: supabaseHeaders(false),
    });
    if (!response.ok) console.error(`Smoke user cleanup returned ${response.status}`);
  } catch (error) {
    console.error('Smoke user cleanup failed:', error?.message || error);
  }
}

try {
  userId = await adminCreateUser();
  const token = await signIn();

  const created = await workerExam(token, 'create', {
    p_request_id: randomUUID(),
    p_bank_id: 1,
    p_session_type: 'standard',
    p_limit: 1,
    p_difficulties: [],
    p_categories: [],
    p_topics: [],
    p_question_selection: 'all',
  });

  const sessionId = created?.session?.id;
  const question = created?.questions?.[0];
  const questionId = question?.id;
  const optionId = question?.options?.[0]?.id;
  if (!sessionId || !questionId || !optionId) throw new Error('Create response did not contain session/question/option');

  const submitted = await workerExam(token, 'submit', {
    p_request_id: randomUUID(),
    p_session_id: sessionId,
    p_question_id: Number(questionId),
    p_selected_option_id: Number(optionId),
    p_time_spent_seconds: 1,
  });
  if (Number(submitted?.answer?.question_id) !== Number(questionId)) throw new Error('Submit response question mismatch');

  const completed = await workerExam(token, 'complete', { p_session_id: sessionId });
  const completedOk = completed?.ok === true || completed?.completed === true || completed?.status === 'completed' || completed?.is_completed === true || typeof completed?.completed_at === 'string';
  if (!completedOk) throw new Error(`Complete response did not confirm completion: ${JSON.stringify(completed).slice(0, 300)}`);

  const types = await waitForSync(sessionId);
  console.log(JSON.stringify({
    ok: true,
    create: 'passed',
    submit: 'passed',
    complete: 'passed',
    queue_to_supabase: 'passed',
    synced_event_types: types,
  }));
} finally {
  await cleanup();
}

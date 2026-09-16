import { randomUUID } from 'node:crypto';

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const secret = process.env.SUPABASE_SECRET_KEY;
const previewOrigin = process.env.PREVIEW_ORIGIN?.replace(/\/+$/, '');
const shareToken = process.env.VERCEL_SHARE_TOKEN;

if (!supabaseUrl || !secret || !previewOrigin || !shareToken) {
  throw new Error('Missing SUPABASE_URL, SUPABASE_SECRET_KEY, PREVIEW_ORIGIN, or VERCEL_SHARE_TOKEN');
}

const RUN = process.env.GITHUB_RUN_ID || String(Date.now());
const email = `royal-edge-smoke-${RUN}-${Date.now()}@example.com`;
const password = `Smoke!${randomUUID()}Aa1`;
let userId = null;
let sessionId = null;
let vercelCookie = '';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const adminHeaders = (json = true) => ({
  apikey: secret,
  authorization: `Bearer ${secret}`,
  ...(json ? { 'content-type': 'application/json' } : {}),
  accept: 'application/json',
  'user-agent': 'royal-edge-preview-smoke/1.0',
});

async function body(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

async function expectOk(response, label) {
  const parsed = await body(response);
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${JSON.stringify(parsed).slice(0, 500)}`);
  }
  return parsed;
}

function mergeSetCookies(response) {
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  const pairs = setCookies.map((value) => String(value).split(';', 1)[0]).filter(Boolean);
  if (!pairs.length) return;
  const jar = new Map(
    vercelCookie
      .split(';')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((pair) => {
        const i = pair.indexOf('=');
        return [pair.slice(0, i), pair.slice(i + 1)];
      }),
  );
  for (const pair of pairs) {
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  vercelCookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function establishVercelAccess() {
  const response = await fetch(`${previewOrigin}/?_vercel_share=${encodeURIComponent(shareToken)}`, {
    redirect: 'manual',
    headers: { 'user-agent': 'royal-edge-preview-smoke/1.0' },
  });
  mergeSetCookies(response);
  if (!vercelCookie && response.status >= 400) {
    throw new Error(`Vercel share access failed (${response.status})`);
  }
}

async function previewCall(token, action, args) {
  const payload = JSON.stringify({ action, args });
  const firstUrl = `${previewOrigin}/api/exam-edge?_vercel_share=${encodeURIComponent(shareToken)}`;
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    accept: 'application/json',
    'user-agent': 'royal-edge-preview-smoke/1.0',
    ...(vercelCookie ? { cookie: vercelCookie } : {}),
  };

  let response = await fetch(firstUrl, {
    method: 'POST',
    redirect: 'manual',
    headers,
    body: payload,
  });
  mergeSetCookies(response);

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) throw new Error(`${action} received redirect without Location`);
    response = await fetch(new URL(location, previewOrigin), {
      method: 'POST',
      redirect: 'manual',
      headers: {
        ...headers,
        ...(vercelCookie ? { cookie: vercelCookie } : {}),
      },
      body: payload,
    });
    mergeSetCookies(response);
  }

  const parsed = await body(response);
  const proxy = response.headers.get('x-royal-proxy');
  const gateway = response.headers.get('x-royal-gateway');
  console.log(`EDGE_${action.toUpperCase()} ${JSON.stringify({ status: response.status, proxy, gateway, body: parsed })}`);
  if (!response.ok) {
    throw new Error(`${action} failed (${response.status}): ${JSON.stringify(parsed).slice(0, 500)}`);
  }
  if (proxy !== 'cloudflare-edge') throw new Error(`${action} did not traverse the Vercel Cloudflare proxy`);
  if (gateway !== 'cloudflare-v2') throw new Error(`${action} did not reach the Cloudflare V2 Worker`);
  return parsed;
}

async function deleteRows(table) {
  if (!userId) return;
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
  url.searchParams.set('user_id', `eq.${userId}`);
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { ...adminHeaders(false), prefer: 'return=minimal' },
  });
  if (!response.ok) console.error(`Cleanup ${table} returned ${response.status}`);
}

async function waitForMaterialization() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const url = new URL(`${supabaseUrl}/rest/v1/edge_exam_sessions`);
    url.searchParams.set('select', 'session_id,status,completed_at,correct_count,incorrect_count,unanswered_count');
    url.searchParams.set('user_id', `eq.${userId}`);
    url.searchParams.set('session_id', `eq.${sessionId}`);
    const rows = await expectOk(await fetch(url, { headers: adminHeaders(false) }), 'Read materialized session');
    const row = Array.isArray(rows) ? rows[0] : null;
    if (row?.completed_at) return row;
    await sleep(1500);
  }
  throw new Error('Completed session did not materialize within 45 seconds');
}

async function cleanup() {
  for (const table of ['edge_exam_answers', 'edge_exam_session_questions', 'edge_exam_flags', 'edge_exam_sessions', 'edge_exam_sync_inbox']) {
    try { await deleteRows(table); } catch (error) { console.error(`Cleanup ${table}: ${error?.message || error}`); }
  }
  if (userId) {
    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        headers: adminHeaders(false),
      });
      if (!response.ok) console.error(`Auth cleanup returned ${response.status}`);
    } catch (error) {
      console.error(`Auth cleanup: ${error?.message || error}`);
    }
  }
}

try {
  await establishVercelAccess();

  const createdUser = await expectOk(await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: 'Royal Edge Smoke' } }),
  }), 'Create smoke user');
  userId = createdUser?.id || createdUser?.user?.id;
  if (!userId) throw new Error('Smoke user creation returned no id');

  const signedIn = await expectOk(await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ email, password }),
  }), 'Sign in smoke user');
  const token = signedIn?.access_token;
  if (!token) throw new Error('Sign in returned no access token');

  const prepared = await previewCall(token, 'prepare', { p_bank_id: 1 });
  if (prepared?.prepared !== true) throw new Error('Prepare did not return prepared=true');

  const created = await previewCall(token, 'create', {
    p_request_id: randomUUID(),
    p_bank_id: 1,
    p_session_type: 'standard',
    p_limit: 3,
    p_difficulties: [],
    p_categories: [],
    p_topics: [],
    p_question_selection: 'all',
  });
  sessionId = created?.session?.id;
  const firstQuestion = created?.questions?.[0];
  if (!sessionId || !firstQuestion?.id || !firstQuestion?.options?.[0]?.id) {
    throw new Error('Create response is missing session/question/option data');
  }

  await previewCall(token, 'bootstrap', { p_session_id: sessionId });
  await previewCall(token, 'window', { p_session_id: sessionId, p_start: 1, p_count: 2 });
  await previewCall(token, 'flag', { p_question_id: Number(firstQuestion.id), p_flagged: true });
  await previewCall(token, 'submit', {
    p_request_id: randomUUID(),
    p_session_id: sessionId,
    p_question_id: Number(firstQuestion.id),
    p_selected_option_id: Number(firstQuestion.options[0].id),
    p_time_spent_seconds: 2,
  });
  await previewCall(token, 'suspend', { p_session_id: sessionId });
  await previewCall(token, 'resume', { p_session_id: sessionId });
  await previewCall(token, 'complete', { p_session_id: sessionId });

  const materialized = await waitForMaterialization();
  console.log(`EDGE_MATERIALIZED ${JSON.stringify(materialized)}`);
  console.log(`EDGE_SMOKE_SUMMARY ${JSON.stringify({ ok: true, user_id: userId, session_id: sessionId, materialized })}`);
} finally {
  await cleanup();
}

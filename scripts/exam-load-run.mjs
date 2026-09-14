import fs from 'node:fs';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { runStage, summarize } from './exam-load-metrics.mjs';

const target = process.env.TARGET_URL;
if (target !== 'https://royal-bank-nhr8.vercel.app') throw new Error('Unexpected Royal target');
if (new URL(process.env.SUPABASE_URL).hostname !== 'trnvsgenmzhyuayxxdoq.supabase.co') {
  throw new Error('Unexpected Supabase project');
}
const users = JSON.parse(fs.readFileSync('load-cookies.json', 'utf8'));
if (users.length !== 16) throw new Error('Expected exactly 16 isolated test users');
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const report = { target, at: new Date().toISOString(), tooling_commit: process.env.LOAD_TOOLING_COMMIT || process.env.GITHUB_SHA,
  deployed_commits: [], setup: [], stages: [], passed: false };
const save = () => fs.writeFileSync('exam-load-results.json', JSON.stringify(report, null, 2));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const scenarios = ['all', 'new_only', 'filtered', 'incorrect_only'];
const argsFor = scenario => ({ p_request_id: crypto.randomUUID(), p_bank_id: 1,
  p_session_type: 'standard', p_limit: scenario === 'incorrect_only' ? 1 : 40,
  p_difficulties: scenario === 'filtered' ? ['1'] : [], p_categories: [], p_topics: [],
  p_question_selection: scenario === 'filtered' ? 'all' : scenario });

async function request(user, action, args, token, scenario = 'setup') {
  const start = performance.now();
  let row, json;
  try {
    const headers = { 'content-type': 'application/json', cookie: user.cookie,
      'user-agent': 'RoyalBank-Authorized-Staged-Load/20260914' };
    if (token) headers['x-royal-window-access'] = token;
    const response = await fetch(`${target}/api/exam`, { method: 'POST', redirect: 'manual',
      headers, body: JSON.stringify({ action, args }), signal: AbortSignal.timeout(10000) });
    const raw = await response.text();
    try { json = JSON.parse(raw); } catch { /* Fail closed on non-JSON responses. */ }
    const valid = action !== 'create' || (uuid.test(json?.session?.id || '')
      && typeof json?.window_access_token === 'string' && json.window_access_token.length > 0
      && Array.isArray(json?.questions) && json.questions.length > 0);
    row = { action, scenario, status: response.status,
      ok: response.status === 200 && json != null && !json.error && valid,
      ms: +(performance.now() - start).toFixed(1),
      timing: response.headers.get('server-timing'), request_id: response.headers.get('x-royal-request-id'),
      timeout_stage: response.headers.get('x-royal-timeout-stage'),
      error: json?.error?.code || null };
    const commit = response.headers.get('x-royal-build');
    if (commit && !report.deployed_commits.includes(commit)) report.deployed_commits.push(commit);
  } catch (error) {
    row = { action, scenario, status: 0, ok: false,
      ms: +(performance.now() - start).toFixed(1), error: error.name };
  }
  // Never write cookies, access tokens, question content, or user identifiers.
  console.log('EXAM_LOAD_REQUEST ' + JSON.stringify(row));
  return { row, json };
}

async function setupRequest(user, action, args, token) {
  const result = await request(user, action, args, token);
  report.setup.push(result.row); save();
  if (!result.row.ok) throw new Error(`Setup ${action} failed: ${result.row.status}/${result.row.error}`);
  if (result.row.ms > 5000) throw new Error(`Setup ${action} exceeded 5 seconds; no escalation`);
  return result.json;
}

try {
  // Populate actual history through the API. Correctness lookup is limited to a
  // question just disclosed in an isolated test session, and is never logged.
  for (const user of users) {
    const created = await setupRequest(user, 'create', argsFor('all'));
    const session = created.session.id;
    const window = await setupRequest(user, 'window',
      { p_session_id: session, p_start: 0, p_count: 1 }, created.window_access_token);
    const question = window?.[0];
    if (!question?.options?.length) throw new Error('Invalid seed question');
    const wrong = await admin.from('options').select('id').eq('question_id', question.id)
      .eq('is_correct', false).limit(1).single();
    if (wrong.error || !question.options.some(o => Number(o.id) === Number(wrong.data?.id))) {
      throw new Error('Cannot select valid incorrect seed answer');
    }
    const selected = Number(wrong.data.id);
    await setupRequest(user, 'submit', { p_request_id: crypto.randomUUID(), p_session_id: session,
      p_question_id: question.id, p_selected_option_id: selected, p_time_spent_seconds: 15 });
    const resumed = await setupRequest(user, 'bootstrap', { p_session_id: session });
    const saved = result => result?.answers?.some(a => Number(a.question_id) === Number(question.id)
      && Number(a.selected_option_id) === selected && a.is_correct === false);
    if (!saved(resumed)) throw new Error('Incorrect answer did not persist on resume');
    await setupRequest(user, 'complete', { p_session_id: session });
    const reviewed = await setupRequest(user, 'reviewBootstrap', { p_session_id: session });
    if (!saved(reviewed)) throw new Error('Incorrect answer did not persist in review');
  }
  report.history_verified_users = users.length;
  // Validate all selectors before load. Incorrect-only has one eligible seeded
  // answer per user and uses limit=1; it must not be compared as a 40-question case.
  for (let i = 0; i < scenarios.length; i++) {
    await setupRequest(users[i], 'create', argsFor(scenarios[i]));
  }
  for (const rate of [1, 3, 5]) {
    const stage = await runStage({ rate, durationSeconds: 20, users: users.length,
      send: async (i, userIndex) => {
        const scenario = scenarios[(Math.floor(i / users.length) + userIndex) % scenarios.length];
        return (await request(users[userIndex], 'create', argsFor(scenario), null, scenario)).row;
      } });
    stage.by_scenario = Object.fromEntries(scenarios.map(s => [s,
      summarize(stage.rows.filter(r => r.scenario === s))]));
    report.stages.push(stage); save();
    console.log('EXAM_LOAD_STAGE ' + JSON.stringify({ ...stage, rows: undefined }));
    if (!stage.passed) throw new Error(`Stopped at ${rate} RPS: ${stage.stop_reason}`);
  }
  report.passed = true;
} catch (error) {
  report.stop_reason = error.message;
  process.exitCode = 1;
} finally {
  save();
  console.log('EXAM_LOAD_SUMMARY ' + JSON.stringify({ ...report,
    setup: summarize(report.setup), stages: report.stages.map(s => ({ ...s, rows: undefined })) }));
}

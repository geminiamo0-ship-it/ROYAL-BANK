import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const users = JSON.parse(open('../load-cookies.json'));
const target = (__ENV.TARGET_URL || '').replace(/\/$/, '');
const vus = Math.max(1, Math.min(Number(__ENV.LOAD_VUS || 10), users.length));

const flowErrors = new Rate('flow_errors');
const server5xx = new Rate('server_5xx');
const rateLimited = new Rate('rate_limited');
const bankMs = new Trend('bank_ms', true);
const createMs = new Trend('create_ms', true);
const windowMs = new Trend('window_ms', true);
const submitMs = new Trend('submit_ms', true);
const completeMs = new Trend('complete_ms', true);

export const options = {
  scenarios: { students: { executor: 'per-vu-iterations', vus: vus, iterations: 1, maxDuration: '90s' } },
  thresholds: {
    flow_errors: ['rate<0.02'],
    server_5xx: ['rate<0.01'],
    rate_limited: ['rate<0.02'],
    bank_ms: ['p(95)<2000'],
    create_ms: ['p(95)<5000'],
    window_ms: ['p(95)<2500'],
    submit_ms: ['p(95)<4000'],
    complete_ms: ['p(95)<5000'],
  },
  userAgent: 'RoyalBank-Authorized-LoadTest/2.0',
};

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
  });
}

function record(res, trend) {
  trend.add(res.timings.duration);
  server5xx.add(res.status === 0 || res.status >= 500);
  rateLimited.add(res.status === 429);
}

function gateway(cookie, action, args, token) {
  const headers = { 'content-type': 'application/json', cookie: cookie };
  if (token) headers['x-royal-window-access'] = token;
  return http.post(target + '/api/exam', JSON.stringify({ action: action, args: args }), {
    headers: headers,
    redirects: 0,
    tags: { action: action },
  });
}

function fail(label, res) {
  flowErrors.add(true, { step: label });
  const status = res && res.status ? res.status : 0;
  const body = res && res.body ? String(res.body).slice(0, 240) : '';
  console.error(label + ': status=' + status + ' body=' + body);
}

export default function () {
  const cookie = users[(__VU - 1) % users.length].cookie;

  const bank = http.get(target + '/bank/1', {
    headers: { cookie: cookie },
    redirects: 0,
    tags: { action: 'bank' },
  });
  record(bank, bankMs);
  if (!check(bank, { 'bank authenticated': function (r) { return r.status === 200; } })) return fail('bank', bank);

  const create = gateway(cookie, 'create', {
    p_request_id: uuid(),
    p_bank_id: 1,
    p_session_type: 'standard',
    p_limit: 10,
    p_difficulties: [],
    p_categories: [],
    p_topics: [],
    p_question_selection: 'all',
  });
  record(create, createMs);
  let bootstrap = null;
  try { bootstrap = create.json(); } catch (e) { bootstrap = null; }
  const session = bootstrap && bootstrap.session ? bootstrap.session : null;
  if (!check(create, {
    'create 200': function (r) { return r.status === 200; },
    'session created': function () { return Boolean(session && session.id); },
    'release pinned': function () { return /^[0-9a-f]{64}$/.test(String(session && session.content_release_id ? session.content_release_id : '')); },
    'window token issued': function () { return Boolean(bootstrap && bootstrap.window_access_token); },
  })) return fail('create', create);

  const sessionId = session.id;
  const token = bootstrap.window_access_token;
  const w0 = gateway(cookie, 'window', { p_session_id: sessionId, p_start: 0, p_count: 3 }, token);
  record(w0, windowMs);
  let questions = null;
  try { questions = w0.json(); } catch (e) { questions = null; }
  if (!check(w0, {
    'window0 200': function (r) { return r.status === 200; },
    'window0 hydrated': function () { return Array.isArray(questions) && questions.length > 0; },
  })) return fail('window0', w0);

  const w3 = gateway(cookie, 'window', { p_session_id: sessionId, p_start: 3, p_count: 3 }, token);
  record(w3, windowMs);
  if (!check(w3, { 'window3 200': function (r) { return r.status === 200; } })) return fail('window3', w3);

  const q = questions[0];
  const option = q && q.options && q.options.length ? q.options[0] : null;
  if (!q || !q.id || !option || !option.id) {
    flowErrors.add(true, { step: 'question-shape' });
    return;
  }

  const submit = gateway(cookie, 'submit', {
    p_request_id: uuid(),
    p_session_id: sessionId,
    p_question_id: Number(q.id),
    p_selected_option_id: Number(option.id),
    p_time_spent_seconds: 8,
  });
  record(submit, submitMs);
  let submitted = null;
  try { submitted = submit.json(); } catch (e) { submitted = null; }
  const answer = submitted && submitted.answer ? submitted.answer : null;
  if (!check(submit, {
    'submit 200': function (r) { return r.status === 200; },
    'answer persisted': function () { return Number(answer && answer.question_id) === Number(q.id); },
    'feedback hydrated': function () { return Boolean(submitted && submitted.feedback); },
  })) return fail('submit', submit);

  const complete = gateway(cookie, 'complete', { p_session_id: sessionId });
  record(complete, completeMs);
  if (!check(complete, { 'complete 200': function (r) { return r.status === 200; } })) return fail('complete', complete);
  flowErrors.add(false);
}

export function handleSummary(data) {
  function value(name, key) {
    if (!data.metrics[name] || !data.metrics[name].values) return null;
    const result = data.metrics[name].values[key];
    return typeof result === 'undefined' ? null : result;
  }
  console.log('ROYAL_AUTH_LOAD_SUMMARY ' + JSON.stringify({
    vus: vus,
    checks_rate: value('checks', 'rate'),
    flow_error_rate: value('flow_errors', 'rate'),
    server_5xx_rate: value('server_5xx', 'rate'),
    rate_limited_rate: value('rate_limited', 'rate'),
    http_reqs: value('http_reqs', 'count'),
    http_p95_ms: value('http_req_duration', 'p(95)'),
    bank_p95_ms: value('bank_ms', 'p(95)'),
    create_p95_ms: value('create_ms', 'p(95)'),
    window_p95_ms: value('window_ms', 'p(95)'),
    submit_p95_ms: value('submit_ms', 'p(95)'),
    complete_p95_ms: value('complete_ms', 'p(95)'),
  }));
  return {};
}

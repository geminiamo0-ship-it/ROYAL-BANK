import fs from 'node:fs';
import crypto from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const target = process.env.TARGET_URL;
const supabaseUrl = process.env.SUPABASE_URL;
if (target !== 'https://royal-bank-five.vercel.app') throw new Error('Unexpected Royal target');
if (!supabaseUrl || new URL(supabaseUrl).hostname !== 'trnvsgenmzhyuayxxdoq.supabase.co') {
  throw new Error('Unexpected Supabase project');
}

const expectedUsers = Number(process.env.LOAD_USER_COUNT || 60);
const users = JSON.parse(fs.readFileSync('load-cookies.json', 'utf8'));
if (!Array.isArray(users) || users.length !== expectedUsers) {
  throw new Error(`Expected exactly ${expectedUsers} isolated authenticated users`);
}

const rates = String(process.env.PAGE_LOAD_RATES || '2,5,10,20')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0 && value <= 25);
const durationSeconds = Math.max(5, Math.min(20, Number(process.env.PAGE_LOAD_DURATION_SECONDS || 12)));
const articleId = 'lib_002e0685cb5c28ff286fe77460755d8d';

const routes = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'pathway', path: '/pathway/mrcp-part-1' },
  { name: 'bank-home', path: '/bank/1' },
  { name: 'sessions', path: '/bank/1/sessions' },
  { name: 'question-bank', path: '/bank/1/question-bank' },
  { name: 'study-plan', path: '/bank/1/study-plan' },
  { name: 'study-plan-create', path: '/bank/1/study-plan/create' },
  { name: 'textbook-catalog', path: '/bank/1/textbook/high-yield' },
  { name: 'textbook-article', path: `/bank/1/textbook/high-yield/${articleId}` },
];

const report = {
  target,
  at: new Date().toISOString(),
  tooling_commit: process.env.GITHUB_SHA || null,
  user_count: users.length,
  seed: { attempted: 0, successful: 0, failed: 0, rows: [] },
  routes: [],
  passed: true,
};
const save = () => fs.writeFileSync('page-load-results.json', JSON.stringify(report, null, 2));

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function summarize(rows) {
  const durations = rows.map((row) => row.ms);
  const statusCounts = {};
  const cacheCounts = {};
  for (const row of rows) {
    statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
    cacheCounts[row.vercel_cache || 'none'] = (cacheCounts[row.vercel_cache || 'none'] || 0) + 1;
  }
  return {
    requests: rows.length,
    successful: rows.filter((row) => row.ok).length,
    errors: rows.filter((row) => !row.ok).length,
    error_rate: rows.length ? +(rows.filter((row) => !row.ok).length / rows.length).toFixed(4) : 0,
    p50_ms: percentile(durations, 0.5),
    p95_ms: percentile(durations, 0.95),
    p99_ms: percentile(durations, 0.99),
    max_ms: durations.length ? Math.max(...durations) : null,
    status_counts: statusCounts,
    vercel_cache: cacheCounts,
  };
}

async function fetchPage(user, route, requestIndex) {
  const started = performance.now();
  try {
    const response = await fetch(`${target}${route.path}`, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      headers: {
        cookie: user.cookie,
        accept: 'text/html,application/xhtml+xml',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        'user-agent': 'RoyalBank-Authorized-Page-Load/20260920',
        'x-royal-load-request': String(requestIndex),
      },
      signal: AbortSignal.timeout(12_000),
    });
    const body = await response.text();
    const contentType = response.headers.get('content-type') || '';
    const loginBody = body.includes('/login?redirect=') || body.includes('Authentication required');
    const ok =
      response.status === 200 &&
      contentType.includes('text/html') &&
      body.length > 500 &&
      !loginBody;
    return {
      route: route.name,
      status: response.status,
      ok,
      ms: +(performance.now() - started).toFixed(1),
      bytes: Buffer.byteLength(body),
      content_type: contentType,
      vercel_cache: response.headers.get('x-vercel-cache'),
      vercel_id: response.headers.get('x-vercel-id'),
      location: response.headers.get('location'),
      error: ok ? null : loginBody ? 'auth_redirect_body' : `http_${response.status}`,
    };
  } catch (error) {
    return {
      route: route.name,
      status: 0,
      ok: false,
      ms: +(performance.now() - started).toFixed(1),
      bytes: 0,
      content_type: '',
      vercel_cache: null,
      vercel_id: null,
      location: null,
      error: error instanceof Error ? error.name : 'request_error',
    };
  }
}

async function examRequest(user, action, args, token = null) {
  const headers = {
    'content-type': 'application/json',
    cookie: user.cookie,
    'user-agent': 'RoyalBank-Authorized-Page-Load/20260920',
  };
  if (token) headers['x-royal-window-access'] = token;
  const response = await fetch(`${target}/api/exam`, {
    method: 'POST',
    redirect: 'manual',
    headers,
    body: JSON.stringify({ action, args }),
    signal: AbortSignal.timeout(12_000),
  });
  const raw = await response.text();
  let json = null;
  try { json = JSON.parse(raw); } catch {}
  if (!response.ok || json?.error) {
    throw new Error(`${action} failed: ${response.status}/${json?.error?.code || 'invalid_json'}`);
  }
  return json;
}

async function seedUser(user, index) {
  const started = performance.now();
  report.seed.attempted += 1;
  try {
    await examRequest(user, 'prepare', { p_bank_id: 1 });
    const created = await examRequest(user, 'create', {
      p_request_id: crypto.randomUUID(),
      p_bank_id: 1,
      p_session_type: 'standard',
      p_limit: 5,
      p_difficulties: [],
      p_categories: [],
      p_topics: [],
      p_question_selection: 'all',
    });
    const sessionId = created?.session?.id;
    const windowToken = created?.window_access_token;
    if (typeof sessionId !== 'string' || typeof windowToken !== 'string') {
      throw new Error('create returned invalid session');
    }
    const windowRows = await examRequest(user, 'window', {
      p_session_id: sessionId,
      p_start: 0,
      p_count: 1,
    }, windowToken);
    const question = Array.isArray(windowRows) ? windowRows[0] : null;
    const option = question?.options?.[0];
    if (!question?.id || !option?.id) throw new Error('window returned no usable question');
    await examRequest(user, 'submit', {
      p_request_id: crypto.randomUUID(),
      p_session_id: sessionId,
      p_question_id: Number(question.id),
      p_selected_option_id: Number(option.id),
      p_time_spent_seconds: 15,
    });
    await examRequest(user, 'complete', { p_session_id: sessionId });

    report.seed.successful += 1;
    report.seed.rows.push({
      index,
      ok: true,
      ms: +(performance.now() - started).toFixed(1),
    });
  } catch (error) {
    report.seed.failed += 1;
    report.seed.rows.push({
      index,
      ok: false,
      ms: +(performance.now() - started).toFixed(1),
      error: error instanceof Error ? error.message : 'seed_error',
    });
  }
  save();
}

async function seedHistory() {
  for (let start = 0; start < users.length; start += 5) {
    await Promise.all(users.slice(start, start + 5).map((user, offset) => seedUser(user, start + offset)));
    if (report.seed.failed > Math.max(2, Math.ceil(users.length * 0.05))) {
      throw new Error(`Too many seed failures: ${report.seed.failed}/${report.seed.attempted}`);
    }
    await sleep(250);
  }
  console.log('PAGE_LOAD_SEED ' + JSON.stringify({
    attempted: report.seed.attempted,
    successful: report.seed.successful,
    failed: report.seed.failed,
  }));
  // Queue/Supabase materialization is asynchronous. Give completed snapshots time to settle.
  await sleep(10_000);
}

async function warmRoute(route) {
  const rows = await Promise.all(users.slice(0, 3).map((user, index) => fetchPage(user, route, index)));
  const bad = rows.find((row) => !row.ok);
  if (bad) throw new Error(`Warmup failed for ${route.name}: ${bad.status}/${bad.error}`);
}

async function runStage(route, rate) {
  const expected = Math.floor(rate * durationSeconds);
  const rows = [];
  const pending = new Set();
  const started = performance.now();
  let launchLagMax = 0;

  for (let i = 0; i < expected; i += 1) {
    const due = started + (i * 1000) / rate;
    const wait = due - performance.now();
    if (wait > 0) await sleep(wait);

    const lag = Math.max(0, performance.now() - due);
    launchLagMax = Math.max(launchLagMax, lag);
    const user = users[i % users.length];
    const task = fetchPage(user, route, i)
      .then((row) => rows.push({ ...row, launch_lag_ms: +lag.toFixed(1) }))
      .finally(() => pending.delete(task));
    pending.add(task);

    if (pending.size >= 80) {
      await Promise.race(pending);
    }
  }

  await Promise.all(pending);
  const elapsedMs = performance.now() - started;
  const summary = summarize(rows);
  const unsafe =
    summary.error_rate > 0.05 ||
    (summary.p95_ms != null && summary.p95_ms > 8000) ||
    launchLagMax > 1000;

  return {
    offered_rps: rate,
    duration_seconds: durationSeconds,
    expected_requests: expected,
    elapsed_ms: +elapsedMs.toFixed(1),
    launch_lag_max_ms: +launchLagMax.toFixed(1),
    achieved_rps: +(summary.successful / Math.max(durationSeconds, elapsedMs / 1000)).toFixed(2),
    ...summary,
    safe_to_escalate: !unsafe,
    rows,
  };
}

try {
  await seedHistory();

  for (const route of routes) {
    await warmRoute(route);
    const routeResult = { name: route.name, path: route.path, stages: [], stopped_early: false };

    for (const rate of rates) {
      const stage = await runStage(route, rate);
      routeResult.stages.push(stage);
      save();

      console.log('PAGE_LOAD_STAGE ' + JSON.stringify({
        route: route.name,
        path: route.path,
        offered_rps: stage.offered_rps,
        achieved_rps: stage.achieved_rps,
        requests: stage.requests,
        successful: stage.successful,
        errors: stage.errors,
        p50_ms: stage.p50_ms,
        p95_ms: stage.p95_ms,
        p99_ms: stage.p99_ms,
        max_ms: stage.max_ms,
        status_counts: stage.status_counts,
        launch_lag_max_ms: stage.launch_lag_max_ms,
        safe_to_escalate: stage.safe_to_escalate,
      }));

      if (!stage.safe_to_escalate) {
        routeResult.stopped_early = true;
        break;
      }
      await sleep(4_000);
    }

    report.routes.push(routeResult);
    save();
    await sleep(8_000);
  }

  report.passed = report.routes.every((route) =>
    route.stages.length > 0 && route.stages.every((stage) => stage.error_rate <= 0.05)
  );
} catch (error) {
  report.passed = false;
  report.stop_reason = error instanceof Error ? error.message : 'unknown_error';
  process.exitCode = 1;
} finally {
  save();
  console.log('PAGE_LOAD_SUMMARY ' + JSON.stringify({
    target: report.target,
    user_count: report.user_count,
    seed: {
      attempted: report.seed.attempted,
      successful: report.seed.successful,
      failed: report.seed.failed,
    },
    routes: report.routes.map((route) => ({
      name: route.name,
      path: route.path,
      stopped_early: route.stopped_early,
      stages: route.stages.map((stage) => ({
        offered_rps: stage.offered_rps,
        achieved_rps: stage.achieved_rps,
        requests: stage.requests,
        successful: stage.successful,
        errors: stage.errors,
        p50_ms: stage.p50_ms,
        p95_ms: stage.p95_ms,
        p99_ms: stage.p99_ms,
        max_ms: stage.max_ms,
        status_counts: stage.status_counts,
        safe_to_escalate: stage.safe_to_escalate,
      })),
    })),
    passed: report.passed,
    stop_reason: report.stop_reason || null,
  }));
}

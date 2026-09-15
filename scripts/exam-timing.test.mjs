import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { NextRequest } from 'next/server.js';

const require = createRequire(import.meta.url);
function loadTs(path, mocks, env, clock, fetcher) {
  const source = fs.readFileSync(path, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const loadedModule = { exports: {} };
  const localRequire = name => name === 'server-only' ? {} : (mocks[name] ?? require(name));
  new Function('require', 'exports', 'module', 'process', 'performance', 'fetch', code)(
    localRequire, loadedModule.exports, loadedModule, { env }, clock, fetcher);
  return loadedModule.exports;
}

function fixture({ rateError = false, hydrateTimeout = false, fastPath = false, timing = true } = {}) {
  let now = 0;
  const clock = { now: () => now };
  const env = { ROYAL_GATEWAY_KEY_ID: 'test', ROYAL_GATEWAY_KEY: 'test',
    ROYAL_RISK_HMAC_SECRET: 'test', ROYAL_GATEWAY_RATE_LIMIT_ENABLED: 'true',
    ROYAL_GATEWAY_RATE_LIMIT_ID: 'test', ROYAL_GATEWAY_TIMING_ENABLED: String(timing),
    SUPABASE_JWKS: JSON.stringify({ keys: [] }) };
  const server = loadTs('src/lib/exam-gateway-server.ts', {}, env, clock);
  const payload = JSON.stringify({ session: { id: 'test', content_release_id: 'a'.repeat(64) } });
  const mocks = {
    '@/lib/exam-gateway-server': { ...server, PINNED_SUPABASE_JWKS: { kind: 'disabled' } },
    '@/lib/supabase/env': { getSupabaseServerConfig: () => ({ url: 'https://test.supabase.co', publishableKey: 'test' }) },
    '@supabase/supabase-js': { createClient: () => ({ auth: {
      getClaims: async () => { now += 3; return { data: { claims: { sub: 'user',
        iss: 'https://test.supabase.co/auth/v1', aud: 'authenticated', role: 'authenticated' } } }; },
    } }) },
    '@/lib/vercel-firewall-rate-limit': { checkVercelRateLimit: async () => {
      now += 7; return { rateLimited: false, error: rateError }; } },
    '@/lib/exam-gateway-contract': { EXAM_RPC_BY_ACTION: { create: 'create', window: 'window' },
      parseExamGatewayRequest: value => ({ ok: true, value }) },
    '@/lib/exam-r2-content': { isExamR2ContentEnabled: () => true,
      r2RpcNameForAction: () => 'create_r2', resolveActiveExamContentRelease: async () => {
        now += 11; return { releaseId: 'a'.repeat(64) }; },
      hydrateExamR2Response: async () => { now += 13;
        if (hydrateTimeout) throw new DOMException('timeout', 'TimeoutError'); return payload; } },
    '@/lib/exam-window-fast-path': { EXAM_WINDOW_ACCESS_HEADER: 'x-royal-window-access',
      trySignedExamWindowFastPath: async () => { now += 17; return fastPath ? '[]' : null; },
      attachExamWindowAccess: ({ rawBody }) => { now += 2; return rawBody; } },
  };
  const route = loadTs('src/app/api/exam/route.ts', mocks, env, clock,
    async () => { now += 19; return new Response(payload, { status: 200 }); });
  const send = (action = 'create', headers = { authorization: 'Bearer test' }) => route.POST(
    new Request('https://test/api/exam', { method: 'POST', headers,
      body: JSON.stringify({ action, args: {} }) }));
  return { send };
}
const timings = response => Object.fromEntries(
  [...(response.headers.get('server-timing') || '').matchAll(/(\w+);dur=([\d.]+)/g)]
    .map(m => [m[1], Number(m[2])]));

test('Create separates RPC, release lookup and R2 hydration without changing success', async () => {
  const response = await fixture().send();
  assert.equal(response.status, 200);
  const t = timings(response);
  assert.equal(t.auth, 3); assert.equal(t.rate_limit, 7);
  assert.equal(t.release_lookup, 11); assert.equal(t.upstream_fetch, 19);
  assert.equal(t.r2_hydrate, 13); assert.equal(t.window_sign, 2);
  assert.equal(t.total_server, 55);
  assert.ok(response.headers.get('x-royal-request-id'));
});
test('fail-closed rate limit error includes elapsed timing and request ID', async () => {
  const response = await fixture({ rateError: true }).send();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'EXAM_RATE_LIMIT_UNAVAILABLE');
  assert.equal(timings(response).rate_limit, 7);
  assert.ok(response.headers.get('x-royal-request-id'));
});
test('R2 timeout preserves timing through finally and keeps timeout stage', async () => {
  const response = await fixture({ hydrateTimeout: true }).send();
  assert.equal(response.status, 504);
  assert.equal(response.headers.get('x-royal-timeout-stage'), 'r2_hydrate');
  assert.equal(timings(response).r2_hydrate, 13);
});
test('window fast path is not mislabeled as database upstream time', async () => {
  const response = await fixture({ fastPath: true }).send('window');
  assert.equal(response.status, 200);
  assert.equal(timings(response).window_fast_path, 17);
  assert.equal(timings(response).upstream_fetch, 0);
});
test('early 401 is observable and timing flag remains optional', async () => {
  const response = await fixture().send('create', {});
  assert.equal(response.status, 401);
  assert.ok(response.headers.get('server-timing'));
  const disabled = await fixture({ timing: false }).send('create', {});
  assert.equal(disabled.headers.get('server-timing'), null);
});
test('middleware overwrites forged diagnostic header and strips incoming bearer', async () => {
  for (const enabled of [true, false]) {
    let now = 0;
    const env = { ROYAL_GATEWAY_TIMING_ENABLED: String(enabled) };
    const mocks = {
      './config': { isSupabaseConfigured: () => true },
      '@/lib/supabase/env': { getSupabaseServerConfig: () => ({ url: 'https://test.supabase.co', publishableKey: 'test' }) },
      '@/lib/supabase/session-cookies': { getRoyalAuthCookieOptions: () => ({}), hardenAuthCookie: value => value },
      '@supabase/ssr': { createServerClient: () => ({ auth: { getSession: async () => {
        now = 9; return { data: { session: null } }; } } }) },
    };
    const { updateSession } = loadTs('src/lib/supabase/middleware.ts', mocks, env, { now: () => now });
    const response = await updateSession(new NextRequest('https://test/api/exam', { headers: {
      'x-royal-internal-middleware-ms': '99999', authorization: 'Bearer forged',
    } }));
    assert.equal(response.headers.get('x-middleware-request-x-royal-internal-middleware-ms'), enabled ? '9.0' : null);
    assert.equal(response.headers.get('x-middleware-request-authorization'), null);
  }
});

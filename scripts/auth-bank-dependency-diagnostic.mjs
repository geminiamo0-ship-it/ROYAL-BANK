import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createServerClient } from '@supabase/ssr';

const url = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!url || !publishableKey) throw new Error('Missing Supabase configuration.');
const users = JSON.parse(fs.readFileSync('load-cookies.json', 'utf8'));

function percentile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return Number(sorted[Math.max(0, index)].toFixed(2));
}

function cookieJar(cookieHeader) {
  const jar = new Map();
  for (const part of String(cookieHeader || '').split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    jar.set(part.slice(0, eq), part.slice(eq + 1));
  }
  return jar;
}

function makeClient(cookieHeader) {
  const jar = cookieJar(cookieHeader);
  return createServerClient(url, publishableKey, {
    cookieOptions: { name: 'royal-auth', path: '/', sameSite: 'lax', secure: true, httpOnly: true },
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach((cookie) => jar.set(cookie.name, cookie.value)),
    },
    auth: { autoRefreshToken: false, persistSession: true, detectSessionInUrl: false },
  });
}

async function runPhase(name, fn) {
  const rows = await Promise.all(users.map(async (account) => {
    const client = makeClient(account.cookie);
    const started = performance.now();
    try {
      const result = await fn(client);
      const ms = performance.now() - started;
      return { ok: !result?.error, ms, code: result?.error?.code || null, status: result?.error?.status || null };
    } catch (error) {
      return { ok: false, ms: performance.now() - started, code: 'THROWN', status: null, detail: String(error) };
    }
  }));
  const values = rows.map((r) => r.ms);
  const failures = {};
  for (const row of rows.filter((r) => !r.ok)) {
    const key = `${row.status || 0}:${row.code || 'unknown'}`;
    failures[key] = (failures[key] || 0) + 1;
  }
  console.log(`${name} ` + JSON.stringify({
    total: rows.length,
    ok: rows.filter((r) => r.ok).length,
    p50_ms: percentile(values, 0.5),
    p95_ms: percentile(values, 0.95),
    max_ms: Number(Math.max(...values).toFixed(2)),
    failures,
  }));
}

console.log(`Starting direct dependency diagnostic with ${users.length} authenticated users.`);
await runPhase('DIRECT_AUTH_GET_USER', (client) => client.auth.getUser());
await new Promise((resolve) => setTimeout(resolve, 3000));
await runPhase('DIRECT_ACTIVE_RPC', (client) => client.rpc('is_active_user'));
await new Promise((resolve) => setTimeout(resolve, 3000));
await runPhase('DIRECT_BANK_PERFORMANCE_RPC', (client) => client.rpc('get_question_bank_performance', { p_bank_id: 1 }));

import fs from 'node:fs';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!url || !serviceKey || !publishableKey) throw new Error('Missing Supabase load-test configuration.');

const requestedCount = Number(process.env.LOAD_USER_COUNT || 1000);
const userCount = Math.max(1, Math.min(Number.isFinite(requestedCount) ? Math.floor(requestedCount) : 1000, 1000));
const requestedPacingMs = Number(process.env.LOAD_AUTH_PACING_MS || 1200);
const authPacingMs = Math.max(0, Math.min(Number.isFinite(requestedPacingMs) ? Math.floor(requestedPacingMs) : 1200, 10000));
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const password = `RoyalLoad!${crypto.randomBytes(24).toString('base64url')}`;
const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
const baseRunTag = String(process.env.GITHUB_RUN_ID || Date.now()).replace(/\D/g, '').slice(-12) || String(Date.now());
const shard = String(process.env.LOAD_SHARD || '').replace(/[^0-9A-Za-z_-]/g, '').slice(0, 20);
const runTag = shard ? `${baseRunTag}-s${shard}` : baseRunTag;
const rows = [];
const ids = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function signInWithRateLimitRetry(client) {
  let lastError = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const signedIn = await client.auth.signInWithPassword({ email: client.__loadEmail, password });
    if (!signedIn.error) return;
    lastError = signedIn.error;
    const rateLimited = signedIn.error.status === 429 || signedIn.error.code === 'over_request_rate_limit';
    if (!rateLimited) throw signedIn.error;
    const waitMs = Math.min(60000, 5000 * (2 ** attempt));
    console.log(`Auth preparation rate-limited; retrying in ${waitMs}ms.`);
    await sleep(waitMs);
  }
  throw lastError || new Error('Could not authenticate load user.');
}

for (let i = 1; i <= userCount; i += 1) {
  const email = `royal-load-${runTag}-${String(i).padStart(4, '0')}@load.invalid`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `Royal Load ${i}`, load_test: true, run_tag: runTag, base_run_tag: baseRunTag, shard },
  });
  if (created.error || !created.data.user) throw created.error || new Error(`Could not create load user ${i}`);
  const user = created.data.user;
  ids.push(user.id);
  fs.writeFileSync('load-user-ids.json', JSON.stringify(ids));

  const profile = await admin.from('profiles').update({ is_active: true, role: 'student' }).eq('id', user.id);
  if (profile.error) throw profile.error;

  const grant = await admin.from('user_access_grants').insert({
    user_id: user.id,
    scope_type: 'bank',
    question_bank_id: 1,
    starts_at: new Date().toISOString(),
    expires_at: expiresAt,
  });
  if (grant.error) throw grant.error;

  const jar = new Map();
  const client = createServerClient(url, publishableKey, {
    cookieOptions: { name: 'royal-auth', path: '/', sameSite: 'lax', secure: true, httpOnly: true },
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach((cookie) => jar.set(cookie.name, cookie.value)),
    },
    auth: { autoRefreshToken: false, persistSession: true, detectSessionInUrl: false },
  });
  client.__loadEmail = email;

  await signInWithRateLimitRetry(client);
  const cookie = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  if (!cookie.includes('royal-auth')) throw new Error(`Auth cookie missing for load user ${i}`);
  rows.push({ email, cookie });
  fs.writeFileSync('load-cookies.json', JSON.stringify(rows));

  if (i % 25 === 0 || i === userCount) console.log(`Prepared ${i}/${userCount} isolated authenticated users for shard ${shard || 'single'}.`);
  if (authPacingMs > 0 && i < userCount) await sleep(authPacingMs);
}

console.log(`Prepared ${rows.length} isolated authenticated users for run ${runTag}.`);

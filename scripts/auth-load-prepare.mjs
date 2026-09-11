import fs from 'node:fs';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!url || !serviceKey || !publishableKey) throw new Error('Missing Supabase load-test configuration.');

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const password = `RoyalLoad!${crypto.randomBytes(24).toString('base64url')}`;
const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listed.error) throw listed.error;
const byEmail = new Map((listed.data.users || []).map((u) => [u.email, u]));
const rows = [];

for (let i = 1; i <= 25; i += 1) {
  const email = `royal-load-${String(i).padStart(3, '0')}@load.invalid`;
  let user = byEmail.get(email);
  if (!user) {
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `Royal Load ${i}` },
    });
    if (created.error || !created.data.user) throw created.error || new Error(`Could not create ${email}`);
    user = created.data.user;
  } else {
    const updated = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true });
    if (updated.error) throw updated.error;
  }

  const profile = await admin.from('profiles').update({ is_active: true, role: 'student' }).eq('id', user.id);
  if (profile.error) throw profile.error;
  const grants = await admin.from('user_access_grants').select('id').eq('user_id', user.id).eq('scope_type', 'bank').eq('question_bank_id', 1).is('revoked_at', null).limit(1);
  if (grants.error) throw grants.error;
  if (!grants.data?.length) {
    const grant = await admin.from('user_access_grants').insert({ user_id: user.id, scope_type: 'bank', question_bank_id: 1, starts_at: new Date().toISOString(), expires_at: expiresAt });
    if (grant.error) throw grant.error;
  }

  const jar = new Map();
  const client = createServerClient(url, publishableKey, {
    cookieOptions: { name: 'royal-auth', path: '/', sameSite: 'lax', secure: true, httpOnly: true },
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach((cookie) => jar.set(cookie.name, cookie.value)),
    },
    auth: { autoRefreshToken: false, persistSession: true, detectSessionInUrl: false },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  const cookie = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  if (!cookie.includes('royal-auth')) throw new Error(`Auth cookie missing for ${email}`);
  rows.push({ email, cookie });
}

fs.writeFileSync('load-cookies.json', JSON.stringify(rows));
console.log(`Prepared ${rows.length} isolated authenticated users.`);

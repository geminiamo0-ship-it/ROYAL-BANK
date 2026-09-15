import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('Missing Supabase cleanup configuration.');

if (new URL(url).hostname !== 'trnvsgenmzhyuayxxdoq.supabase.co') throw new Error('Unexpected Supabase project');

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
let ids = [];
try {
  ids = JSON.parse(fs.readFileSync('load-user-ids.json', 'utf8'));
} catch {}
ids = Array.isArray(ids) ? [...new Set(ids.filter(Boolean))] : [];

const runTag = String(process.env.GITHUB_RUN_ID || '').replace(/\D/g, '').slice(-12);
if (ids.length && !runTag) throw new Error('Cleanup requires the creating workflow run ID');
for (const id of ids) {
  const result = await admin.auth.admin.getUserById(id);
  if (result.error?.status === 404) continue;
  if (result.error || !result.data.user?.email?.startsWith(`royal-load-${runTag}-`)
    || !result.data.user.email.endsWith('@load.invalid')) throw new Error('Cleanup scope mismatch');
}
if (ids.length) {
  const sessions = await admin.from('test_sessions').delete().in('user_id', ids);
  if (sessions.error) throw sessions.error;

  const grants = await admin.from('user_access_grants').delete().in('user_id', ids);
  if (grants.error) throw grants.error;
}

let removed = 0;
for (const id of ids) {
  const deleted = await admin.auth.admin.deleteUser(id, false);
  if (deleted.error && deleted.error.status !== 404 && deleted.error.code !== 'user_not_found') throw deleted.error;
  if (!deleted.error) removed += 1;
}
console.log(`Removed ${removed}/${ids.length} isolated load users after clearing exam data.`);



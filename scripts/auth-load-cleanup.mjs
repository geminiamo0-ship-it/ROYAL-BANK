import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('Missing Supabase cleanup configuration.');

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
let ids = [];
try {
  ids = JSON.parse(fs.readFileSync('load-user-ids.json', 'utf8'));
} catch {}
ids = Array.isArray(ids) ? [...new Set(ids.filter(Boolean))] : [];

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

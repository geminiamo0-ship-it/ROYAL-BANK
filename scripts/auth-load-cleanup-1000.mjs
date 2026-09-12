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

const chunk = (items, size) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

for (const batch of chunk(ids, 25)) {
  const sessions = await admin.from('test_sessions').delete().in('user_id', batch);
  if (sessions.error) throw sessions.error;

  const grants = await admin.from('user_access_grants').delete().in('user_id', batch);
  if (grants.error) throw grants.error;
}

let removed = 0;
for (const id of ids) {
  const deleted = await admin.auth.admin.deleteUser(id, false);
  if (deleted.error && deleted.error.status !== 404 && deleted.error.code !== 'user_not_found') throw deleted.error;
  if (!deleted.error) removed += 1;
  if (removed % 100 === 0 || removed === ids.length) console.log(`Removed ${removed}/${ids.length} isolated load users.`);
}

console.log(`Cleanup complete: ${removed}/${ids.length} isolated load users removed.`);

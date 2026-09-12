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

const chunk = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (const batch of chunk(ids, 100)) {
  const sessions = await admin.from('test_sessions').delete().in('user_id', batch);
  if (sessions.error) throw sessions.error;

  const grants = await admin.from('user_access_grants').delete().in('user_id', batch);
  if (grants.error) throw grants.error;
}

let removed = 0;
for (const batch of chunk(ids, 10)) {
  const results = await Promise.all(batch.map(async (id) => {
    const deleted = await admin.auth.admin.deleteUser(id, false);
    if (deleted.error && deleted.error.status !== 404 && deleted.error.code !== 'user_not_found') throw deleted.error;
    return !deleted.error;
  }));
  removed += results.filter(Boolean).length;
  if (removed % 100 === 0 || removed === ids.length) console.log(`Cleanup ${removed}/${ids.length} load users.`);
  await sleep(100);
}

console.log(`Removed ${removed}/${ids.length} isolated load users after clearing exam data.`);

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const runTag = String(process.env.LOAD_RUN_TAG_TO_CLEAN || '').trim();
if (!url || !serviceKey || !runTag) throw new Error('Missing cleanup-by-run-tag configuration.');

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const ids = [];

for (let page = 1; page <= 20; page += 1) {
  const listed = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  if (listed.error) throw listed.error;
  const users = listed.data?.users || [];
  for (const user of users) {
    const tag = String(user.user_metadata?.run_tag || '');
    if (tag === runTag || String(user.email || '').startsWith(`royal-load-${runTag}-`)) ids.push(user.id);
  }
  if (users.length < 1000) break;
}

const uniqueIds = [...new Set(ids)];
const batches = [];
for (let i = 0; i < uniqueIds.length; i += 25) batches.push(uniqueIds.slice(i, i + 25));

for (const batch of batches) {
  const sessions = await admin.from('test_sessions').delete().in('user_id', batch);
  if (sessions.error) throw sessions.error;
  const grants = await admin.from('user_access_grants').delete().in('user_id', batch);
  if (grants.error) throw grants.error;
}

let removed = 0;
for (const id of uniqueIds) {
  const deleted = await admin.auth.admin.deleteUser(id, false);
  if (deleted.error && deleted.error.status !== 404 && deleted.error.code !== 'user_not_found') throw deleted.error;
  if (!deleted.error) removed += 1;
}

console.log(`Cleanup-by-run-tag ${runTag}: removed ${removed}/${uniqueIds.length} users.`);

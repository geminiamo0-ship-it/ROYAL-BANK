import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('Missing Supabase cleanup configuration.');

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listed.error) throw listed.error;
const users = (listed.data.users || []).filter((u) => /^royal-load-\d{3}@load\.invalid$/.test(u.email || ''));
const ids = users.map((u) => u.id);

if (ids.length) {
  const sessions = await admin.from('test_sessions').delete().in('user_id', ids);
  if (sessions.error) throw sessions.error;

  const grants = await admin.from('user_access_grants').delete().in('user_id', ids);
  if (grants.error) throw grants.error;
}

for (const user of users) {
  const deleted = await admin.auth.admin.deleteUser(user.id, false);
  if (deleted.error) throw deleted.error;
}
console.log(`Removed ${users.length} isolated load users after clearing exam data.`);

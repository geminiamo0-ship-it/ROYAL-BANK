import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  subscription_tier: string | null;
  is_active: boolean | null;
  last_login_at: string | null;
  last_login_ip: string | null;
  created_at: string;
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function AdminUsersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/admin/users');

  const { data, error } = await supabase
    .from('profiles')
    .select('id,full_name,email,role,subscription_tier,is_active,last_login_at,last_login_ip,created_at')
    .order('created_at', { ascending: false })
    .limit(250);

  if (error) throw new Error(error.message);
  const users = (data || []) as ProfileRow[];

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-16">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-purple-600">Live profiles</p>
        <h1 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">User Accounts</h1>
        <p className="mt-1 text-xs text-slate-500">Read-only production profile view. Premium entitlement is still determined by user_access_grants, not the profile tier label.</p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-3 text-xs font-semibold text-slate-500 dark:border-slate-800">{users.length} most recent profiles</div>
        {users.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">No profiles are visible to this admin account.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/50"><tr><th className="px-4 py-3">User</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">UI tier</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Last login</th><th className="px-4 py-3">Last IP</th><th className="px-4 py-3">Joined</th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {users.map((profile) => (
                  <tr key={profile.id}>
                    <td className="px-4 py-3"><p className="font-semibold text-slate-900 dark:text-white">{profile.full_name || 'Unnamed user'}</p><p className="mt-0.5 text-slate-500">{profile.email || profile.id}</p></td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{profile.role || 'student'}</td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{profile.subscription_tier || '—'}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${profile.is_active ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300'}`}>{profile.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDate(profile.last_login_at)}</td>
                    <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">{profile.last_login_ip || '—'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDate(profile.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

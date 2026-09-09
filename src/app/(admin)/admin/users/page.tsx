import Link from 'next/link';
import { Search, Settings2 } from 'lucide-react';
import { listAdminUsers } from '@/actions/admin-operations';
import { UserPasswordResetAction } from '@/components/admin/UserPasswordResetAction';
import { createClient } from '@/lib/supabase/server';

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    role?: string | string[];
    status?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const search = first(params.q)?.trim() || '';
  const rawRole = first(params.role) || '';
  const role = ['student', 'support', 'admin'].includes(rawRole)
    ? (rawRole as 'student' | 'support' | 'admin')
    : null;
  const status = first(params.status) || '';
  const isActive = status === 'active' ? true : status === 'inactive' ? false : null;

  const supabase = await createClient();
  const [{ data: { user } }, usersResult] = await Promise.all([
    supabase.auth.getUser(),
    listAdminUsers({ search, role, isActive, limit: 250, offset: 0 }),
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-16">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-purple-600">Release C · Operations</p>
        <h1 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">Users & Subscriptions</h1>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
          Search live Royal accounts, manage roles and suspension, inspect access history, grant/extend/revoke entitlements, and issue audited temporary passwords.
        </p>
      </div>

      <form method="get" className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:grid-cols-[1fr_170px_170px_auto] dark:border-slate-800 dark:bg-slate-900">
        <label className="relative">
          <span className="sr-only">Search users</span>
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            name="q"
            defaultValue={search}
            placeholder="Search name, email or exact user ID"
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
        </label>
        <select name="role" defaultValue={role || ''} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950">
          <option value="">All roles</option>
          <option value="student">Students</option>
          <option value="support">Support</option>
          <option value="admin">Admins</option>
        </select>
        <select name="status" defaultValue={status} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Suspended</option>
        </select>
        <button type="submit" className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-700">
          <Settings2 className="h-3.5 w-3.5" /> Filter
        </button>
      </form>

      {!usersResult.ok ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {usersResult.error}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-5 py-3 text-xs font-semibold text-slate-500 dark:border-slate-800">
            {usersResult.data.length} matching profiles
          </div>
          {usersResult.data.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">No users match these filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1240px] text-left text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/50">
                  <tr>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Active access</th>
                    <th className="px-4 py-3">Last login</th>
                    <th className="px-4 py-3">Last IP</th>
                    <th className="px-4 py-3">Joined</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {usersResult.data.map((profile) => {
                    const activeGrantCount = Number(profile.active_grant_count || 0);
                    return (
                      <tr key={profile.id} className="align-top">
                        <td className="px-4 py-3">
                          <Link href={`/admin/users/${profile.id}`} className="font-semibold text-slate-900 hover:text-purple-600 dark:text-white">
                            {profile.full_name || 'Unnamed user'}
                          </Link>
                          <p className="mt-0.5 text-slate-500">{profile.email}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{profile.role}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${profile.is_active ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300'}`}>
                            {profile.is_active ? 'Active' : 'Suspended'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-800 dark:text-slate-100">{activeGrantCount.toLocaleString()} grants</p>
                          <p className="mt-0.5 text-[10px] text-slate-400">
                            {activeGrantCount === 0
                              ? 'No premium entitlement'
                              : profile.latest_access_expires_at
                                ? `Latest dated expiry ${formatDate(profile.latest_access_expires_at)}`
                                : 'Includes permanent access'}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDate(profile.last_login_at)}</td>
                        <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">{profile.last_login_ip || '—'}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDate(profile.created_at)}</td>
                        <td className="px-4 py-3">
                          <div className="space-y-2">
                            <Link href={`/admin/users/${profile.id}`} className="inline-flex rounded-md bg-purple-600 px-2.5 py-1.5 text-[10px] font-semibold text-white hover:bg-purple-700">
                              Manage account
                            </Link>
                            <UserPasswordResetAction
                              userId={profile.id}
                              email={profile.email}
                              disabled={profile.id === user?.id}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import React from 'react';
import { Search, UserCheck, UserX } from 'lucide-react';
import { setAdminUserActive } from '@/actions/admin-operations';
import { createClient } from '@/lib/supabase/server';

interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
  subscription_tier: string;
  is_active: boolean;
  last_login_at: string | null;
  last_login_ip: string | null;
  created_at: string;
}

interface GrantRow {
  user_id: string;
  scope_type: 'global' | 'pathway' | 'bank';
  starts_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams;
  const supabase = await createClient();
  const { data: profilesData, error: profilesError } = await supabase
    .from('profiles')
    .select('id,full_name,email,role,subscription_tier,is_active,last_login_at,last_login_ip,created_at')
    .order('created_at', { ascending: false })
    .limit(500);

  if (profilesError) throw new Error(profilesError.message);
  const profiles = (profilesData || []) as ProfileRow[];
  const profileIds = profiles.map((profile) => profile.id);
  let grants: GrantRow[] = [];

  if (profileIds.length > 0) {
    const { data: grantData, error: grantError } = await supabase
      .from('user_access_grants')
      .select('user_id,scope_type,starts_at,expires_at,revoked_at')
      .in('user_id', profileIds);
    if (grantError) throw new Error(grantError.message);
    grants = (grantData || []) as GrantRow[];
  }

  const now = Date.now();
  const activeGrantsByUser = new Map<string, GrantRow[]>();
  for (const grant of grants) {
    if (grant.revoked_at) continue;
    if (new Date(grant.starts_at).getTime() > now) continue;
    if (grant.expires_at && new Date(grant.expires_at).getTime() <= now) continue;
    activeGrantsByUser.set(grant.user_id, [...(activeGrantsByUser.get(grant.user_id) || []), grant]);
  }

  const normalized = q.trim().toLowerCase();
  const visibleProfiles = normalized
    ? profiles.filter((profile) =>
        [profile.full_name || '', profile.email, profile.last_login_ip || '', profile.id]
          .some((value) => value.toLowerCase().includes(normalized)),
      )
    : profiles;

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-16 text-xs sm:text-sm">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Users</h1>
          <p className="text-xs text-slate-500">Live profile, login, account status, and premium-grant data.</p>
        </div>
        <form method="get" className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input name="q" defaultValue={q} placeholder="Name, email, IP, or user ID" className="w-72 rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
          </div>
          <button type="submit" className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white dark:bg-slate-100 dark:text-slate-900">Search</button>
        </form>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead><tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-800/60"><th className="px-4 py-3">Account</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Premium grants</th><th className="px-4 py-3">Last login</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Action</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {visibleProfiles.map((profile) => {
                const activeGrants = activeGrantsByUser.get(profile.id) || [];
                const global = activeGrants.some((grant) => grant.scope_type === 'global');
                const pathwayCount = activeGrants.filter((grant) => grant.scope_type === 'pathway').length;
                const bankCount = activeGrants.filter((grant) => grant.scope_type === 'bank').length;
                const action = setAdminUserActive.bind(null, profile.id, !profile.is_active);
                return (
                  <tr key={profile.id} className="align-top hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-3"><p className="font-semibold text-slate-900 dark:text-white">{profile.full_name || 'No name'}</p><p className="text-xs text-slate-500">{profile.email}</p><p className="mt-1 font-mono text-[10px] text-slate-400">{profile.id}</p></td>
                    <td className="px-4 py-3"><p className="font-semibold text-slate-700 dark:text-slate-200">{profile.role}</p><p className="mt-1 text-[10px] text-slate-400">UI tier: {profile.subscription_tier}</p></td>
                    <td className="px-4 py-3">{activeGrants.length === 0 ? <span className="text-slate-400">No active premium grant</span> : <div className="space-y-1 text-[11px] text-slate-700 dark:text-slate-300">{global && <p>Global access</p>}{pathwayCount > 0 && <p>{pathwayCount} pathway grant{pathwayCount === 1 ? '' : 's'}</p>}{bankCount > 0 && <p>{bankCount} bank grant{bankCount === 1 ? '' : 's'}</p>}</div>}</td>
                    <td className="px-4 py-3"><p className="font-mono text-[11px] text-slate-700 dark:text-slate-300">{profile.last_login_ip || '—'}</p><p className="mt-1 text-[10px] text-slate-400">{profile.last_login_at ? new Date(profile.last_login_at).toLocaleString() : 'No recorded login'}</p></td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${profile.is_active ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'}`}>{profile.is_active ? 'Active' : 'Suspended'}</span></td>
                    <td className="px-4 py-3 text-right"><form action={action}><button type="submit" className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold ${profile.is_active ? 'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950 dark:text-red-300' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-300'}`}>{profile.is_active ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}{profile.is_active ? 'Suspend' : 'Reactivate'}</button></form></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {visibleProfiles.length === 0 && <div className="p-10 text-center text-slate-500">No real accounts match this search.</div>}
      </div>
    </div>
  );
}

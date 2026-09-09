import React from 'react';
import { Ban, Plus, ShieldAlert } from 'lucide-react';
import { addAdminIpBlock, removeAdminIpBlock } from '@/actions/admin-operations';
import { createClient } from '@/lib/supabase/server';

interface BlockedIpRow {
  id: number;
  ip_address: string;
  reason: string;
  blocked_at: string;
  blocked_by: string | null;
}

interface LoginRow {
  id: number;
  user_id: string;
  ip_address: string;
  user_agent: string | null;
  login_at: string;
  is_suspicious: boolean;
}

interface ProfileIdentity {
  id: string;
  full_name: string | null;
  email: string;
}

export default async function AdminSecurityPage() {
  const supabase = await createClient();
  const [blocksResult, loginsResult] = await Promise.all([
    supabase.from('ip_blocklist').select('id,ip_address,reason,blocked_at,blocked_by').order('blocked_at', { ascending: false }),
    supabase.from('login_history').select('id,user_id,ip_address,user_agent,login_at,is_suspicious').eq('is_suspicious', true).order('login_at', { ascending: false }).limit(50),
  ]);

  if (blocksResult.error) throw new Error(blocksResult.error.message);
  if (loginsResult.error) throw new Error(loginsResult.error.message);

  const blocks = (blocksResult.data || []) as BlockedIpRow[];
  const suspiciousLogins = (loginsResult.data || []) as LoginRow[];
  const userIds = [...new Set(suspiciousLogins.map((row) => row.user_id))];
  const identities = new Map<string, ProfileIdentity>();

  if (userIds.length > 0) {
    const { data, error } = await supabase.from('profiles').select('id,full_name,email').in('id', userIds);
    if (error) throw new Error(error.message);
    for (const profile of (data || []) as ProfileIdentity[]) identities.set(profile.id, profile);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-16 text-xs sm:text-sm">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Security & IP Protection</h1>
        <p className="text-xs text-slate-500">Live IP blocklist and suspicious-login records. Changes below write to production data through admin RLS.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"><Ban className="h-4 w-4 text-red-600" />Block IP Address</h2>
          <form action={addAdminIpBlock} className="space-y-4">
            <div><label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">IP Address</label><input name="ipAddress" type="text" placeholder="IPv4 or IPv6" required className="w-full rounded-lg border border-slate-300 bg-white p-2.5 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></div>
            <div><label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">Reason</label><input name="reason" type="text" placeholder="Required audit reason" required maxLength={500} className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></div>
            <button type="submit" className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 py-2.5 text-xs font-semibold text-white hover:bg-red-700"><Plus className="h-4 w-4" />Add to Blocklist</button>
          </form>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900 lg:col-span-2">
          <div className="border-b border-slate-200 px-5 py-4 font-bold text-slate-900 dark:border-slate-800 dark:text-white">Active IP Blocklist ({blocks.length})</div>
          {blocks.length === 0 ? <div className="p-8 text-center text-slate-500">No IP addresses are currently blocked.</div> : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {blocks.map((block) => {
                const removeAction = removeAdminIpBlock.bind(null, block.id);
                return (
                  <div key={block.id} className="flex items-center justify-between gap-4 p-4">
                    <div className="min-w-0 space-y-1"><p className="font-mono text-xs font-bold text-red-600 dark:text-red-400">{block.ip_address}</p><p className="text-xs text-slate-700 dark:text-slate-300">{block.reason}</p><p className="text-[11px] text-slate-400">Blocked {new Date(block.blocked_at).toLocaleString()}</p></div>
                    <form action={removeAction}><button type="submit" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Unblock</button></form>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4 dark:border-slate-800"><ShieldAlert className="h-4 w-4 text-amber-500" /><h2 className="font-bold text-slate-900 dark:text-white">Suspicious login history</h2></div>
        {suspiciousLogins.length === 0 ? <div className="p-8 text-center text-slate-500">No suspicious logins are recorded.</div> : (
          <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/60"><th className="px-4 py-3">Account</th><th className="px-4 py-3">IP</th><th className="px-4 py-3">Time</th><th className="px-4 py-3">User agent</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{suspiciousLogins.map((row) => { const identity = identities.get(row.user_id); return <tr key={row.id}><td className="px-4 py-3"><p className="font-semibold text-slate-900 dark:text-white">{identity?.full_name || identity?.email || row.user_id}</p>{identity?.full_name && <p className="text-[11px] text-slate-500">{identity.email}</p>}</td><td className="px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-300">{row.ip_address}</td><td className="px-4 py-3 text-xs text-slate-500">{new Date(row.login_at).toLocaleString()}</td><td className="max-w-[360px] truncate px-4 py-3 text-[11px] text-slate-500" title={row.user_agent || ''}>{row.user_agent || '—'}</td></tr>; })}</tbody></table></div>
        )}
      </section>
    </div>
  );
}

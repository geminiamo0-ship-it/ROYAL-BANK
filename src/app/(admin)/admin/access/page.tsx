import Link from 'next/link';
import { Search, ShieldCheck } from 'lucide-react';
import { listAdminAccessGrants } from '@/actions/admin-access';

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string | null) {
  if (!value) return 'Permanent';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function AdminAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; status?: string | string[] }>;
}) {
  const params = await searchParams;
  const search = first(params.q)?.trim() || '';
  const rawStatus = first(params.status) || '';
  const status = ['active', 'upcoming', 'expired', 'revoked'].includes(rawStatus)
    ? (rawStatus as 'active' | 'upcoming' | 'expired' | 'revoked')
    : null;
  const result = await listAdminAccessGrants({ search, status, limit: 500, offset: 0 });

  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-16">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-purple-600">Release C · Operations</p>
        <h1 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">Access Management</h1>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
          Centralized view of the authoritative user_access_grants ledger. Historical revoked and expired grants remain visible for audit.
        </p>
      </div>

      <form method="get" className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:grid-cols-[1fr_190px_auto] dark:border-slate-800 dark:bg-slate-900">
        <label className="relative">
          <span className="sr-only">Search access</span>
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            name="q"
            defaultValue={search}
            placeholder="Search user, email, user ID or grant ID"
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs dark:border-slate-700 dark:bg-slate-950"
          />
        </label>
        <select name="status" defaultValue={status || ''} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950">
          <option value="">All grant states</option>
          <option value="active">Active</option>
          <option value="upcoming">Upcoming</option>
          <option value="expired">Expired</option>
          <option value="revoked">Revoked</option>
        </select>
        <button type="submit" className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-700">
          <ShieldCheck className="h-3.5 w-3.5" /> Filter ledger
        </button>
      </form>

      {!result.ok ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{result.error}</div>
      ) : (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-5 py-3 text-xs font-semibold text-slate-500 dark:border-slate-800">{result.data.length} grant records</div>
          {result.data.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">No access grants match these filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-left text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/50">
                  <tr><th className="px-4 py-3">Grant</th><th className="px-4 py-3">User</th><th className="px-4 py-3">Scope</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Starts</th><th className="px-4 py-3">Expires</th><th className="px-4 py-3">Revocation</th><th className="px-4 py-3">Manage</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {result.data.map((grant) => (
                    <tr key={grant.id}>
                      <td className="px-4 py-3 font-mono text-[10px] text-slate-500">#{grant.id}</td>
                      <td className="px-4 py-3"><p className="font-semibold text-slate-900 dark:text-white">{grant.full_name || grant.email}</p><p className="mt-0.5 text-[10px] text-slate-400">{grant.email}</p></td>
                      <td className="px-4 py-3"><p className="font-semibold text-slate-800 dark:text-slate-100">{grant.scope_name}</p><p className="mt-0.5 text-[10px] uppercase text-slate-400">{grant.scope_type}</p></td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${grant.status === 'active' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : grant.status === 'revoked' ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{grant.status}</span></td>
                      <td className="px-4 py-3 text-slate-500">{formatDate(grant.starts_at)}</td>
                      <td className="px-4 py-3 text-slate-500">{formatDate(grant.expires_at)}</td>
                      <td className="max-w-[220px] px-4 py-3 text-slate-500">{grant.revoke_reason || '—'}</td>
                      <td className="px-4 py-3"><Link href={`/admin/users/${grant.user_id}`} className="rounded-md bg-purple-600 px-2.5 py-1.5 text-[10px] font-semibold text-white hover:bg-purple-700">Open user</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

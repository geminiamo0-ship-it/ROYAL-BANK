'use client';

import { FormEvent, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldCheck, UserCheck, UserX } from 'lucide-react';
import {
  extendAdminUserAccess,
  grantAdminUserAccess,
  revokeAdminUserAccess,
  updateAdminUserAccount,
} from '@/actions/admin-operations';
import type { AdminAccessGrantDetail } from '@/types/admin-operations';

interface PathwayOption {
  id: number;
  name: string;
}

interface BankOption {
  id: number;
  pathway_id: number;
  name: string;
}

function localDateTimeToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function defaultExtensionValue(current: string) {
  const currentDate = new Date(current);
  const base = Number.isNaN(currentDate.getTime()) || currentDate < new Date() ? new Date() : currentDate;
  const next = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000);
  const local = new Date(next.getTime() - next.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function UserOperationsClient({
  userId,
  currentRole,
  isActive,
  isSelf,
  grants,
  pathways,
  banks,
}: {
  userId: string;
  currentRole: string;
  isActive: boolean;
  isSelf: boolean;
  grants: AdminAccessGrantDetail[];
  pathways: PathwayOption[];
  banks: BankOption[];
}) {
  const router = useRouter();
  const [role, setRole] = useState(currentRole);
  const [scopeType, setScopeType] = useState<'global' | 'pathway' | 'bank'>('bank');
  const [pathwayId, setPathwayId] = useState('');
  const [bankId, setBankId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedPathwayBanks = useMemo(() => {
    if (!pathwayId) return banks;
    return banks.filter((bank) => bank.pathway_id === Number(pathwayId));
  }, [banks, pathwayId]);

  function finishSuccess(text: string) {
    setError(null);
    setMessage(text);
    router.refresh();
  }

  function saveRole() {
    if (pending || role === currentRole) return;
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await updateAdminUserAccount({ userId, role });
      if (!result.ok) return setError(result.error);
      finishSuccess('Role updated.');
    });
  }

  function toggleActive() {
    if (pending || isSelf) return;
    const nextActive = !isActive;
    const confirmed = window.confirm(
      nextActive
        ? 'Reactivate this account and allow sign-in again?'
        : 'Suspend this account? The user will be blocked from Royal protected routes.',
    );
    if (!confirmed) return;

    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await updateAdminUserAccount({ userId, isActive: nextActive });
      if (!result.ok) return setError(result.error);
      finishSuccess(nextActive ? 'Account reactivated.' : 'Account suspended.');
    });
  }

  function submitGrant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const expiryIso = expiresAt ? localDateTimeToIso(expiresAt) : null;
    if (expiresAt && !expiryIso) {
      setError('Choose a valid expiry date.');
      return;
    }

    const selectedPathway = pathwayId ? Number(pathwayId) : null;
    const selectedBank = bankId ? Number(bankId) : null;

    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await grantAdminUserAccess({
        userId,
        scopeType,
        pathwayId: scopeType === 'pathway' ? selectedPathway : null,
        bankId: scopeType === 'bank' ? selectedBank : null,
        expiresAt: expiryIso,
      });
      if (!result.ok) return setError(result.error);
      setExpiresAt('');
      finishSuccess('Access granted.');
    });
  }

  function extendGrant(grant: AdminAccessGrantDetail) {
    if (!grant.expires_at || pending) return;
    const value = window.prompt(
      `New expiry for ${grant.scope_name} (local date/time):`,
      defaultExtensionValue(grant.expires_at),
    );
    if (!value) return;
    const expiryIso = localDateTimeToIso(value);
    if (!expiryIso) {
      setError('Choose a valid expiry date.');
      return;
    }

    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await extendAdminUserAccess(
        { grantId: Number(grant.id), expiresAt: expiryIso },
        userId,
      );
      if (!result.ok) return setError(result.error);
      finishSuccess('Access extended.');
    });
  }

  function revokeGrant(grant: AdminAccessGrantDetail) {
    if (grant.status === 'revoked' || pending) return;
    const reason = window.prompt(`Reason for revoking ${grant.scope_name}:`);
    if (!reason?.trim()) return;
    if (!window.confirm('Revoke this access now? The historical grant will be preserved.')) return;

    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await revokeAdminUserAccess(
        { grantId: Number(grant.id), reason: reason.trim() },
        userId,
      );
      if (!result.ok) return setError(result.error);
      finishSuccess('Access revoked.');
    });
  }

  return (
    <div className="space-y-5">
      {(error || message) && (
        <div
          className={`rounded-lg border px-4 py-3 text-xs ${
            error
              ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
          }`}
        >
          {error || message}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-bold text-slate-900 dark:text-white">Account control</h2>
            <p className="mt-1 text-[11px] text-slate-500">Role changes and suspension are audited server-side.</p>
          </div>
          <button
            type="button"
            onClick={toggleActive}
            disabled={pending || isSelf}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
              isActive ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : isActive ? (
              <UserX className="h-3.5 w-3.5" />
            ) : (
              <UserCheck className="h-3.5 w-3.5" />
            )}
            {isActive ? 'Suspend user' : 'Reactivate user'}
          </button>
        </div>

        <div className="mt-4 flex max-w-md items-end gap-2">
          <label className="flex-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            Role
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
              disabled={pending || isSelf}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            >
              <option value="student">Student</option>
              <option value="support">Support</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button
            type="button"
            onClick={saveRole}
            disabled={pending || isSelf || role === currentRole}
            className="rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save role
          </button>
        </div>
        {isSelf && <p className="mt-2 text-[10px] text-amber-600">Self-demotion and self-suspension are blocked to prevent administrator lockout.</p>}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-purple-600" />
          <h2 className="font-bold text-slate-900 dark:text-white">Grant access</h2>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">Writes directly to the authoritative user_access_grants ledger.</p>

        <form onSubmit={submitGrant} className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            Scope
            <select
              value={scopeType}
              onChange={(event) => {
                setScopeType(event.target.value as 'global' | 'pathway' | 'bank');
                setPathwayId('');
                setBankId('');
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="bank">Question bank</option>
              <option value="pathway">Pathway</option>
              <option value="global">Global</option>
            </select>
          </label>

          {scopeType === 'pathway' && (
            <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              Pathway
              <select
                required
                value={pathwayId}
                onChange={(event) => setPathwayId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="">Choose pathway</option>
                {pathways.map((pathway) => <option key={pathway.id} value={pathway.id}>{pathway.name}</option>)}
              </select>
            </label>
          )}

          {scopeType === 'bank' && (
            <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              Question bank
              <select
                required
                value={bankId}
                onChange={(event) => setBankId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="">Choose bank</option>
                {selectedPathwayBanks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}
              </select>
            </label>
          )}

          <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            Expiry
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
            />
            <span className="mt-1 block text-[10px] font-normal text-slate-400">Leave blank for permanent access.</span>
          </label>

          <div className="flex items-start pt-[19px]">
            <button
              type="submit"
              disabled={pending}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Grant access
            </button>
          </div>
        </form>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <h2 className="font-bold text-slate-900 dark:text-white">Access history</h2>
          <p className="mt-0.5 text-[10px] text-slate-500">Revoked and expired grants stay visible for audit and support history.</p>
        </div>
        {grants.length === 0 ? (
          <div className="p-5 text-xs text-slate-500">No access grants recorded for this user.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/50">
                <tr><th className="px-4 py-3">Scope</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Starts</th><th className="px-4 py-3">Expires</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {grants.map((grant) => (
                  <tr key={grant.id}>
                    <td className="px-4 py-3"><p className="font-semibold text-slate-900 dark:text-white">{grant.scope_name}</p><p className="text-[10px] text-slate-400">{grant.scope_type} · #{grant.id}</p></td>
                    <td className="px-4 py-3"><span className="rounded-full border border-slate-200 px-2 py-1 text-[10px] font-semibold uppercase dark:border-slate-700">{grant.status}</span></td>
                    <td className="px-4 py-3 text-slate-500">{new Date(grant.starts_at).toLocaleString()}</td>
                    <td className="px-4 py-3 text-slate-500">{grant.expires_at ? new Date(grant.expires_at).toLocaleString() : 'Permanent'}</td>
                    <td className="max-w-[220px] px-4 py-3 text-slate-500">{grant.revoke_reason || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {grant.status !== 'revoked' && grant.expires_at && (
                          <button type="button" onClick={() => extendGrant(grant)} disabled={pending} className="rounded border border-blue-300 px-2 py-1 text-[10px] font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-900 dark:text-blue-300">Extend</button>
                        )}
                        {grant.status !== 'revoked' && (
                          <button type="button" onClick={() => revokeGrant(grant)} disabled={pending} className="rounded border border-red-300 px-2 py-1 text-[10px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300">Revoke</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

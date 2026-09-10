'use client';

import { FormEvent, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldCheck, ShieldOff } from 'lucide-react';
import {
  blockAdminIp,
  setAdminManualReview,
  unblockAdminIp,
} from '@/actions/admin-intelligence';

export function IpBlockForm() {
  const router = useRouter();
  const [ip, setIp] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await blockAdminIp({ ip, reason });
      if (!result.ok) return setError(result.error);
      setIp('');
      setReason('');
      setMessage(`${result.data.ip_address} is blocked.`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <div>
        <h2 className="font-bold text-slate-900 dark:text-white">Block IP address</h2>
        <p className="mt-1 text-[10px] text-slate-500">All changes are server-side, admin-only and written to the admin audit log.</p>
      </div>
      {(error || message) && (
        <div className={`rounded-lg border px-3 py-2 text-[11px] ${error ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'}`}>
          {error || message}
        </div>
      )}
      <input
        value={ip}
        onChange={(event) => setIp(event.target.value)}
        placeholder="IPv4 or IPv6"
        required
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
      />
      <textarea
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Reason for block"
        required
        rows={3}
        className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
      />
      <button type="submit" disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50">
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldOff className="h-3.5 w-3.5" />}
        Block IP
      </button>
    </form>
  );
}

export function UnblockIpButton({ ip }: { ip: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function unblock() {
    if (pending) return;
    const reason = window.prompt(`Reason for unblocking ${ip}:`);
    if (!reason?.trim()) return;
    if (!window.confirm(`Unblock ${ip}?`)) return;

    startTransition(async () => {
      const result = await unblockAdminIp({ ip, reason: reason.trim() });
      if (!result.ok) {
        window.alert(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <button type="button" onClick={unblock} disabled={pending} className="inline-flex items-center gap-1 rounded-md border border-emerald-300 px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-900 dark:text-emerald-300">
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
      Unblock
    </button>
  );
}

export function ManualReviewButton({
  userId,
  required,
}: {
  userId: string;
  required: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    if (pending) return;
    const nextRequired = !required;
    const reason = window.prompt(
      nextRequired
        ? 'Reason for requiring manual security review:'
        : 'Reason for clearing manual security review:',
    );
    if (!reason?.trim()) return;

    startTransition(async () => {
      const result = await setAdminManualReview({ userId, required: nextRequired, reason: reason.trim() });
      if (!result.ok) {
        window.alert(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold disabled:opacity-50 ${required ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-300' : 'border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-900 dark:text-amber-300'}`}
    >
      {pending && <Loader2 className="h-3 w-3 animate-spin" />}
      {required ? 'Clear review' : 'Require review'}
    </button>
  );
}

'use client';

import { FormEvent, useState, useTransition } from 'react';
import { Bot, Loader2, RefreshCw, Search, Sparkles } from 'lucide-react';
import {
  resolveDeepDiveSupportUser,
  type DeepDiveSupportUser,
} from '@/actions/deep-dive-support';

type AllowanceSnapshot = {
  ok?: boolean;
  dayKey?: string;
  usedToday?: number;
  remainingToday?: number;
  dailyLimit?: number;
  followupLimit?: number;
  totalThreads?: number;
  totalFollowups?: number;
  override?: {
    dailyLimit: number;
    followupLimit: number;
    expiresAtMs: number | null;
    updatedAtMs: number;
  } | null;
  error?: { code?: string; message?: string };
};

const inputClass =
  'h-10 w-full rounded-lg border border-slate-700 bg-[#07101e] px-3 text-xs font-medium text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#c49a46] focus:ring-1 focus:ring-[#c49a46]/25 disabled:opacity-50';

function toLocalInput(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return '';
  const date = new Date(ms);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function SupportDeepDiveAllowance() {
  const [identifier, setIdentifier] = useState('');
  const [user, setUser] = useState<DeepDiveSupportUser | null>(null);
  const [snapshot, setSnapshot] = useState<AllowanceSnapshot | null>(null);
  const [dailyLimit, setDailyLimit] = useState('4');
  const [followupLimit, setFollowupLimit] = useState('12');
  const [expiresAt, setExpiresAt] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function syncFields(next: AllowanceSnapshot) {
    setDailyLimit(String(next.dailyLimit ?? 4));
    setFollowupLimit(String(next.followupLimit ?? 12));
    setExpiresAt(toLocalInput(next.override?.expiresAtMs));
  }

  async function loadSnapshot(target: DeepDiveSupportUser) {
    const response = await fetch('/api/deep-dive/admin/entitlement', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'get', userId: target.id }),
    });
    const payload = await response.json() as AllowanceSnapshot;
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error?.message || 'Unable to load AI allowance.');
    }
    setSnapshot(payload);
    syncFields(payload);
  }

  function searchUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    startTransition(async () => {
      setError(null);
      setMessage(null);
      setUser(null);
      setSnapshot(null);

      const result = await resolveDeepDiveSupportUser(identifier);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      setUser(result.data);
      try {
        await loadSnapshot(result.data);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Unable to load AI allowance.');
      }
    });
  }

  function refresh() {
    if (!user || pending) return;
    startTransition(async () => {
      setError(null);
      setMessage(null);
      try {
        await loadSnapshot(user);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Unable to refresh AI allowance.');
      }
    });
  }

  function saveOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || pending) return;

    const daily = Number(dailyLimit);
    const followups = Number(followupLimit);
    const expiryIso = localInputToIso(expiresAt);
    if (!Number.isSafeInteger(daily) || daily < 1 || daily > 1000) {
      setError('Daily Deep Dives must be between 1 and 1000.');
      return;
    }
    if (!Number.isSafeInteger(followups) || followups < 1 || followups > 200) {
      setError('Follow-ups per thread must be between 1 and 200.');
      return;
    }
    if (expiresAt && !expiryIso) {
      setError('Choose a valid override expiry.');
      return;
    }

    startTransition(async () => {
      setError(null);
      setMessage(null);
      try {
        const response = await fetch('/api/deep-dive/admin/entitlement', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'set',
            userId: user.id,
            dailyLimit: daily,
            followupLimit: followups,
            expiresAt: expiryIso,
            reason: reason.trim() || 'Support allowance change',
          }),
        });
        const payload = await response.json() as AllowanceSnapshot;
        if (!response.ok) {
          throw new Error(payload.error?.message || 'Unable to save AI allowance.');
        }
        setMessage('Deep Dive allowance updated immediately.');
        setReason('');
        await loadSnapshot(user);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Unable to save AI allowance.');
      }
    });
  }

  function clearOverride() {
    if (!user || pending || !snapshot?.override) return;
    if (!window.confirm('Return this user to the default Deep Dive allowance?')) return;

    startTransition(async () => {
      setError(null);
      setMessage(null);
      try {
        const response = await fetch('/api/deep-dive/admin/entitlement', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'clear',
            userId: user.id,
            reason: reason.trim() || 'Support reset to default',
          }),
        });
        const payload = await response.json() as AllowanceSnapshot;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error?.message || 'Unable to reset AI allowance.');
        }
        setSnapshot(payload);
        syncFields(payload);
        setReason('');
        setMessage('Default Deep Dive allowance restored.');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Unable to reset AI allowance.');
      }
    });
  }

  return (
    <section className="rounded-2xl border border-[#c49a46]/20 bg-[#0b1627] p-5 shadow-2xl shadow-black/20 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-[#c49a46]/30 bg-[#c49a46]/10 text-[#e2c276]">
            <Sparkles className="h-4.5 w-4.5" />
          </div>
          <div>
            <h2 className="text-sm font-black text-white">Deep Dive AI allowance</h2>
            <p className="mt-1 text-[11px] leading-5 text-slate-400">
              Find any Royal account and change its live per-user Durable Object allowance.
            </p>
          </div>
        </div>
        {user ? (
          <button
            type="button"
            onClick={refresh}
            disabled={pending}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-700 px-3 text-[10px] font-bold text-slate-300 hover:border-slate-600 hover:bg-slate-800/40 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${pending ? 'animate-spin' : ''}`} />
            Refresh live usage
          </button>
        ) : null}
      </div>

      <form onSubmit={searchUser} className="mt-5 flex max-w-2xl gap-2">
        <input
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          placeholder="Account email or user UUID"
          className={inputClass}
          disabled={pending}
        />
        <button
          type="submit"
          disabled={pending || identifier.trim().length < 3}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-[#c49a46] px-4 text-[11px] font-black text-[#16120b] hover:bg-[#d2aa58] disabled:opacity-45"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Find user
        </button>
      </form>

      {error ? (
        <div className="mt-4 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="mt-4 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200">
          {message}
        </div>
      ) : null}

      {user && snapshot ? (
        <div className="mt-5 border-t border-slate-800 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-bold text-white">{user.full_name || user.email}</p>
              <p className="mt-0.5 text-[10px] text-slate-500">{user.email} · {user.id}</p>
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-wide ${
              snapshot.override
                ? 'border-[#c49a46]/30 bg-[#c49a46]/10 text-[#e1c174]'
                : 'border-slate-700 bg-slate-800/40 text-slate-400'
            }`}>
              {snapshot.override ? 'Support override active' : 'Default allowance'}
            </span>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Used today" value={`${snapshot.usedToday ?? 0} / ${snapshot.dailyLimit ?? 4}`} />
            <Metric label="Remaining today" value={String(snapshot.remainingToday ?? 0)} />
            <Metric label="Deep Dive threads" value={String(snapshot.totalThreads ?? 0)} />
            <Metric label="Follow-up messages" value={String(snapshot.totalFollowups ?? 0)} />
          </div>

          <form onSubmit={saveOverride} className="mt-5 rounded-xl border border-slate-800 bg-[#081120] p-4">
            <div className="mb-4 flex items-center gap-2">
              <Bot className="h-4 w-4 text-[#d7b665]" />
              <h3 className="text-xs font-black text-white">Allowance override</h3>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="text-[10px] font-bold text-slate-300">
                New Deep Dives / day
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={dailyLimit}
                  onChange={(event) => setDailyLimit(event.target.value)}
                  className={`${inputClass} mt-1.5`}
                  disabled={pending}
                />
              </label>
              <label className="text-[10px] font-bold text-slate-300">
                Follow-ups / thread
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={followupLimit}
                  onChange={(event) => setFollowupLimit(event.target.value)}
                  className={`${inputClass} mt-1.5`}
                  disabled={pending}
                />
              </label>
              <label className="text-[10px] font-bold text-slate-300">
                Override expiry
                <input
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                  className={`${inputClass} mt-1.5`}
                  disabled={pending}
                />
                <span className="mt-1 block font-normal text-slate-500">Blank = no expiry.</span>
              </label>
              <label className="text-[10px] font-bold text-slate-300">
                Support note
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value.slice(0, 500))}
                  placeholder="Requested by user / plan change"
                  className={`${inputClass} mt-1.5`}
                  disabled={pending}
                />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="mr-1 text-[9px] font-bold uppercase tracking-wide text-slate-500">Quick daily limit</span>
              {[4, 10, 20, 50].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDailyLimit(String(value))}
                  disabled={pending}
                  className="rounded-md border border-slate-700 px-2.5 py-1.5 text-[9px] font-bold text-slate-300 hover:border-[#c49a46]/50 hover:text-[#e2c276] disabled:opacity-50"
                >
                  {value}/day
                </button>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {snapshot.override ? (
                <button
                  type="button"
                  onClick={clearOverride}
                  disabled={pending}
                  className="h-9 rounded-lg border border-slate-700 px-3 text-[10px] font-bold text-slate-300 hover:bg-slate-800/50 disabled:opacity-50"
                >
                  Restore default
                </button>
              ) : null}
              <button
                type="submit"
                disabled={pending}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#c49a46] px-4 text-[10px] font-black text-[#16120b] hover:bg-[#d2aa58] disabled:opacity-50"
              >
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Save allowance
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-[#081120] px-4 py-3">
      <p className="text-[9px] font-bold uppercase tracking-[0.13em] text-slate-500">{label}</p>
      <p className="mt-1.5 text-sm font-black text-slate-100">{value}</p>
    </div>
  );
}

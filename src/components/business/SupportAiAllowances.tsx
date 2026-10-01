'use client';

import { FormEvent, useState, useTransition } from 'react';
import { Bot, Loader2, RefreshCw, Search, Sparkles } from 'lucide-react';
import { resolveDeepDiveSupportUser, type DeepDiveSupportUser } from '@/actions/deep-dive-support';

type DeepSnapshot = {
  ok?: boolean;
  usedToday?: number;
  remainingToday?: number;
  dailyLimit?: number;
  followupLimit?: number;
  totalThreads?: number;
  totalFollowups?: number;
  override?: { dailyLimit: number; followupLimit: number; expiresAtMs: number | null } | null;
  error?: { message?: string };
};

type RoyalSnapshot = {
  ok?: boolean;
  usedToday?: number;
  remainingToday?: number;
  dailyLimit?: number;
  entitled?: boolean;
  totalConversations?: number;
  totalMessages?: number;
  override?: { dailyLimit: number; expiresAtMs: number | null } | null;
  error?: { message?: string };
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

async function post<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || 'AI allowance request failed.');
  return payload;
}

export function SupportAiAllowances() {
  const [identifier, setIdentifier] = useState('');
  const [user, setUser] = useState<DeepDiveSupportUser | null>(null);
  const [deep, setDeep] = useState<DeepSnapshot | null>(null);
  const [royal, setRoyal] = useState<RoyalSnapshot | null>(null);
  const [deepDaily, setDeepDaily] = useState('4');
  const [deepFollowups, setDeepFollowups] = useState('12');
  const [deepExpiry, setDeepExpiry] = useState('');
  const [royalDaily, setRoyalDaily] = useState('15');
  const [royalExpiry, setRoyalExpiry] = useState('');
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function load(target: DeepDiveSupportUser) {
    const [deepPayload, royalPayload] = await Promise.all([
      post<DeepSnapshot>('/api/deep-dive/admin/entitlement', { action: 'get', userId: target.id }),
      post<RoyalSnapshot>('/api/royal-ai/admin/entitlement', { action: 'get', userId: target.id }),
    ]);
    setDeep(deepPayload);
    setRoyal(royalPayload);
    setDeepDaily(String(deepPayload.dailyLimit ?? 4));
    setDeepFollowups(String(deepPayload.followupLimit ?? 12));
    setDeepExpiry(toLocalInput(deepPayload.override?.expiresAtMs));
    setRoyalDaily(String(royalPayload.override?.dailyLimit ?? (royalPayload.dailyLimit || 15)));
    setRoyalExpiry(toLocalInput(royalPayload.override?.expiresAtMs));
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    startTransition(async () => {
      setError(null);
      setNotice(null);
      setUser(null);
      setDeep(null);
      setRoyal(null);
      const result = await resolveDeepDiveSupportUser(identifier);
      if (!result.ok) return setError(result.error);
      setUser(result.data);
      try { await load(result.data); }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load AI allowances.'); }
    });
  }

  function refresh() {
    if (!user || pending) return;
    startTransition(async () => {
      setError(null);
      try { await load(user); }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to refresh AI allowances.'); }
    });
  }

  function saveDeep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || pending) return;
    const daily = Number(deepDaily);
    const followups = Number(deepFollowups);
    const expiresAt = localInputToIso(deepExpiry);
    if (!Number.isSafeInteger(daily) || daily < 1 || daily > 1000) return setError('Deep Dive daily limit must be between 1 and 1000.');
    if (!Number.isSafeInteger(followups) || followups < 1 || followups > 200) return setError('Deep Dive follow-ups must be between 1 and 200.');
    if (deepExpiry && !expiresAt) return setError('Choose a valid Deep Dive expiry.');

    startTransition(async () => {
      setError(null); setNotice(null);
      try {
        await post('/api/deep-dive/admin/entitlement', {
          action: 'set', userId: user.id, dailyLimit: daily, followupLimit: followups,
          expiresAt, reason: reason.trim() || 'Support allowance change',
        });
        await load(user);
        setNotice('Deep Dive allowance updated.');
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to update Deep Dive allowance.'); }
    });
  }

  function saveRoyal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || pending) return;
    const daily = Number(royalDaily);
    const expiresAt = localInputToIso(royalExpiry);
    if (!Number.isSafeInteger(daily) || daily < 1 || daily > 1000) return setError('Royal AI daily messages must be between 1 and 1000.');
    if (royalExpiry && !expiresAt) return setError('Choose a valid Royal AI expiry.');

    startTransition(async () => {
      setError(null); setNotice(null);
      try {
        await post('/api/royal-ai/admin/entitlement', {
          action: 'set', userId: user.id, dailyLimit: daily, expiresAt,
          reason: reason.trim() || 'Support allowance change',
        });
        await load(user);
        setNotice('Royal AI activated / allowance updated.');
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to update Royal AI allowance.'); }
    });
  }

  function clear(which: 'deep' | 'royal') {
    if (!user || pending) return;
    if (!window.confirm(which === 'deep' ? 'Restore the default Deep Dive allowance?' : 'Disable Royal AI for this account?')) return;
    startTransition(async () => {
      setError(null); setNotice(null);
      try {
        const url = which === 'deep' ? '/api/deep-dive/admin/entitlement' : '/api/royal-ai/admin/entitlement';
        await post(url, { action: 'clear', userId: user.id, reason: reason.trim() || 'Support reset to default' });
        await load(user);
        setNotice(which === 'deep' ? 'Default Deep Dive allowance restored.' : 'Royal AI disabled for this account.');
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to reset allowance.'); }
    });
  }

  return (
    <section className="rounded-2xl border border-[#c49a46]/20 bg-[#0b1627] p-5 shadow-2xl shadow-black/20 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-[#c49a46]/30 bg-[#c49a46]/10 text-[#e2c276]"><Sparkles className="h-4.5 w-4.5" /></div>
          <div>
            <h2 className="text-sm font-black text-white">AI allowances</h2>
            <p className="mt-1 text-[11px] leading-5 text-slate-400">One account lookup for Deep Dive and Royal AI.</p>
          </div>
        </div>
        {user ? <button type="button" onClick={refresh} disabled={pending} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-700 px-3 text-[10px] font-bold text-slate-300 hover:bg-slate-800/40 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${pending ? 'animate-spin' : ''}`} />Refresh live usage</button> : null}
      </div>

      <form onSubmit={search} className="mt-5 flex max-w-2xl gap-2">
        <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="Account email or user UUID" className={inputClass} disabled={pending} />
        <button type="submit" disabled={pending || identifier.trim().length < 3} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-[#c49a46] px-4 text-[11px] font-black text-[#16120b] hover:bg-[#d2aa58] disabled:opacity-45">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}Find user
        </button>
      </form>

      {error ? <div className="mt-4 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{error}</div> : null}
      {notice ? <div className="mt-4 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200">{notice}</div> : null}

      {user && deep && royal ? (
        <div className="mt-5 border-t border-slate-800 pt-5">
          <div>
            <p className="text-[13px] font-bold text-white">{user.full_name || user.email}</p>
            <p className="mt-0.5 text-[10px] text-slate-500">{user.email} · {user.id}</p>
          </div>

          <label className="mt-4 block max-w-2xl text-[10px] font-bold text-slate-300">
            Support note for the next change
            <input value={reason} onChange={(e) => setReason(e.target.value.slice(0, 500))} placeholder="Requested by user / plan change" className={`${inputClass} mt-1.5`} disabled={pending} />
          </label>

          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            <form onSubmit={saveDeep} className="rounded-xl border border-slate-800 bg-[#081120] p-4">
              <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-[#d7b665]" /><h3 className="text-xs font-black text-white">Deep Dive</h3></div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Metric label="Used today" value={`${deep.usedToday ?? 0} / ${deep.dailyLimit ?? 4}`} />
                <Metric label="Remaining" value={String(deep.remainingToday ?? 0)} />
                <Metric label="Threads" value={String(deep.totalThreads ?? 0)} />
                <Metric label="Follow-ups" value={String(deep.totalFollowups ?? 0)} />
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <NumberInput label="Deep Dives / day" value={deepDaily} setValue={setDeepDaily} max={1000} pending={pending} />
                <NumberInput label="Follow-ups / thread" value={deepFollowups} setValue={setDeepFollowups} max={200} pending={pending} />
                <DateInput label="Override expiry" value={deepExpiry} setValue={setDeepExpiry} pending={pending} />
              </div>
              <div className="mt-4 flex justify-end gap-2">
                {deep.override ? <button type="button" onClick={() => clear('deep')} disabled={pending} className="h-9 rounded-lg border border-slate-700 px-3 text-[10px] font-bold text-slate-300">Restore default</button> : null}
                <button type="submit" disabled={pending} className="h-9 rounded-lg bg-[#c49a46] px-4 text-[10px] font-black text-[#16120b]">Save Deep Dive</button>
              </div>
            </form>

            <form onSubmit={saveRoyal} className="rounded-xl border border-slate-800 bg-[#081120] p-4">
              <div className="flex items-center gap-2"><Bot className="h-4 w-4 text-[#d7b665]" /><h3 className="text-xs font-black text-white">Royal AI</h3></div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Metric label="Access" value={royal.entitled ? 'Active' : 'Inactive'} />
                <Metric label="Used today" value={royal.entitled ? `${royal.usedToday ?? 0} / ${royal.dailyLimit ?? 15}` : '—'} />
                <Metric label="Conversations" value={String(royal.totalConversations ?? 0)} />
                <Metric label="User messages" value={String(royal.totalMessages ?? 0)} />
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <NumberInput label="Royal AI messages / day" value={royalDaily} setValue={setRoyalDaily} max={1000} pending={pending} />
                <DateInput label="Override expiry" value={royalExpiry} setValue={setRoyalExpiry} pending={pending} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {[15, 25, 50, 100].map((value) => <button key={value} type="button" onClick={() => setRoyalDaily(String(value))} className="rounded-md border border-slate-700 px-2.5 py-1.5 text-[9px] font-bold text-slate-300 hover:border-[#c49a46]/50 hover:text-[#e2c276]">{value}/day</button>)}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                {royal.entitled ? <button type="button" onClick={() => clear('royal')} disabled={pending} className="h-9 rounded-lg border border-slate-700 px-3 text-[10px] font-bold text-slate-300">Disable Royal AI</button> : null}
                <button type="submit" disabled={pending} className="h-9 rounded-lg bg-[#c49a46] px-4 text-[10px] font-black text-[#16120b]">{royal.entitled ? 'Update Royal AI' : 'Activate Royal AI'}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-slate-800 bg-[#0b1627] px-3 py-2.5"><p className="text-[8px] font-bold uppercase tracking-[.12em] text-slate-500">{label}</p><p className="mt-1 text-xs font-black text-slate-100">{value}</p></div>;
}

function NumberInput({ label, value, setValue, max, pending }: { label: string; value: string; setValue: (value: string) => void; max: number; pending: boolean }) {
  return <label className="text-[10px] font-bold text-slate-300">{label}<input type="number" min={1} max={max} value={value} onChange={(e) => setValue(e.target.value)} className={`${inputClass} mt-1.5`} disabled={pending} /></label>;
}

function DateInput({ label, value, setValue, pending }: { label: string; value: string; setValue: (value: string) => void; pending: boolean }) {
  return <label className="text-[10px] font-bold text-slate-300">{label}<input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} className={`${inputClass} mt-1.5`} disabled={pending} /><span className="mt-1 block font-normal text-slate-500">Blank = no expiry.</span></label>;
}

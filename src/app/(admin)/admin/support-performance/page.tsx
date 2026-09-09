import Link from 'next/link';
import { Activity, CheckCircle2, Clock3, CreditCard, Headphones, Inbox } from 'lucide-react';
import { getAdminSupportPerformance } from '@/actions/admin-operations';

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function number(value: number | string | null | undefined) {
  return Number(value || 0).toLocaleString();
}

function minutes(value: number | string | null) {
  if (value == null) return '—';
  const total = Number(value);
  if (!Number.isFinite(total)) return '—';
  if (total < 60) return `${Math.round(total)} min`;
  if (total < 1440) return `${(total / 60).toFixed(1)} h`;
  return `${(total / 1440).toFixed(1)} d`;
}

export default async function AdminSupportPerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawDays = Number(first(params.days) || 30);
  const days = [7, 30, 90].includes(rawDays) ? rawDays : 30;
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const result = await getAdminSupportPerformance({ from: from.toISOString(), to: to.toISOString() });

  if (!result.ok) {
    return (
      <div className="mx-auto max-w-7xl rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
        {result.error}
      </div>
    );
  }

  const data = result.data;
  const summary = data.summary;

  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-purple-600">Release C · Operations</p>
          <h1 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">Support Performance</h1>
          <p className="mt-1 text-xs text-slate-500">Live workflow performance from upgrade requests and recorded payments. No mock metrics.</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
          {[7, 30, 90].map((windowDays) => (
            <Link
              key={windowDays}
              href={`/admin/support-performance?days=${windowDays}`}
              className={`rounded-md px-3 py-1.5 text-[11px] font-semibold ${days === windowDays ? 'bg-purple-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            >
              {windowDays}d
            </Link>
          ))}
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <Metric icon={Headphones} label="Contacts" value={number(summary.contacts)} />
        <Metric icon={CheckCircle2} label="Activations" value={number(summary.activations)} />
        <Metric icon={CreditCard} label="Payments recorded" value={number(summary.payments_recorded)} />
        <Metric icon={Clock3} label="Avg first contact" value={minutes(summary.avg_first_contact_minutes)} />
        <Metric icon={Activity} label="Avg activation" value={minutes(summary.avg_activation_minutes)} />
        <Metric icon={Inbox} label="Open backlog" value={number(summary.open_backlog)} note={`${number(summary.paid_awaiting_activation)} paid waiting`} />
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <h2 className="font-bold text-slate-900 dark:text-white">Agent performance</h2>
          <p className="mt-0.5 text-[10px] text-slate-500">Contacts, activations and payment-recording events attributed to each support/admin actor in this window.</p>
        </div>
        {data.agents.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">No attributed support activity in the selected window.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/50">
                <tr><th className="px-4 py-3">Agent</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Contacts</th><th className="px-4 py-3">Activations</th><th className="px-4 py-3">Payments</th><th className="px-4 py-3">Avg first contact</th><th className="px-4 py-3">Avg activation</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.agents.map((agent) => (
                  <tr key={agent.user_id}>
                    <td className="px-4 py-3"><p className="font-semibold text-slate-900 dark:text-white">{agent.full_name || agent.email}</p><p className="mt-0.5 text-[10px] text-slate-400">{agent.email}</p></td>
                    <td className="px-4 py-3 text-slate-500">{agent.role}</td>
                    <td className="px-4 py-3 font-semibold">{number(agent.contacts)}</td>
                    <td className="px-4 py-3 font-semibold text-emerald-600">{number(agent.activations)}</td>
                    <td className="px-4 py-3 font-semibold">{number(agent.payments_recorded)}</td>
                    <td className="px-4 py-3 text-slate-500">{minutes(agent.avg_first_contact_minutes)}</td>
                    <td className="px-4 py-3 text-slate-500">{minutes(agent.avg_activation_minutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-[10px] leading-4 text-slate-400">
        Timing metrics use request creation → first contact and request creation → activation. Payment counts are event counts only; currencies are deliberately not combined here.
      </p>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 text-slate-400"><Icon className="h-4 w-4" /><span className="text-[10px] font-semibold uppercase tracking-wide">{label}</span></div>
      <p className="mt-2 text-xl font-black text-slate-900 dark:text-white">{value}</p>
      {note && <p className="mt-1 text-[10px] text-slate-400">{note}</p>}
    </div>
  );
}

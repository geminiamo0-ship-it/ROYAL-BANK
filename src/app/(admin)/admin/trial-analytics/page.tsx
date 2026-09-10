import { ArrowRight, Clock3, Gauge, Layers3, Sparkles, Users } from 'lucide-react';
import { getAdminTrialAnalytics } from '@/actions/admin-intelligence';
import {
  IntelligenceWindowTabs,
  resolveIntelligenceWindow,
} from '@/components/admin/IntelligenceWindowTabs';

function n(value: number | string | null | undefined) {
  return Number(value || 0);
}

function fmt(value: number | string | null | undefined) {
  return n(value).toLocaleString();
}

function hours(value: number | string | null) {
  if (value == null) return '—';
  const total = Number(value);
  if (!Number.isFinite(total)) return '—';
  if (total < 24) return `${total.toFixed(1)} h`;
  return `${(total / 24).toFixed(1)} d`;
}

export default async function TrialAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string | string[] }>;
}) {
  const params = await searchParams;
  const window = resolveIntelligenceWindow(params.days);
  const result = await getAdminTrialAnalytics({ from: window.from, to: window.to });

  if (!result.ok) {
    return <ErrorCard message={result.error} />;
  }

  const data = result.data;
  const summary = data.summary;
  const maxDailyBlocks = Math.max(1, ...data.daily.map((row) => n(row.blocks_consumed)));

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-purple-600">Release D · Intelligence</p>
          <h1 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">Trial Analytics</h1>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
            Real free-trial consumption and conversion from the first recorded trial block through activated upgrade requests.
          </p>
        </div>
        <IntelligenceWindowTabs baseHref="/admin/trial-analytics" days={window.days} />
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Sparkles} label="Trial starters" value={fmt(summary.trial_starters)} note="First recorded trial block in this window" />
        <Metric icon={Users} label="Active trial users" value={fmt(summary.active_trial_users)} note={`${fmt(summary.exhausted_trial_users)} reached a configured block limit`} />
        <Metric icon={ArrowRight} label="Converted users" value={fmt(summary.converted_users)} note={`${n(summary.conversion_rate_percent).toFixed(1)}% of starters`} />
        <Metric icon={Clock3} label="Avg time to convert" value={hours(summary.avg_hours_to_convert)} note="First trial use → activated upgrade" />
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Metric icon={Layers3} label="Trial blocks consumed" value={fmt(summary.trial_blocks_consumed)} />
        <Metric icon={Gauge} label="Trial sessions started" value={fmt(summary.trial_sessions_started)} />
        <Metric icon={Gauge} label="Trial questions answered" value={fmt(summary.trial_questions_answered)} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4">
          <h2 className="font-bold text-slate-900 dark:text-white">Daily trial activity</h2>
          <p className="mt-1 text-[10px] text-slate-500">Bar length represents blocks consumed; starter and conversion counts are shown alongside each day.</p>
        </div>
        <div className="space-y-2">
          {data.daily.map((row) => {
            const blocks = n(row.blocks_consumed);
            return (
              <div key={row.date} className="grid grid-cols-[88px_1fr_auto] items-center gap-3 text-[11px]">
                <time className="font-medium text-slate-500">{new Date(`${row.date}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className="h-full rounded-full bg-purple-600" style={{ width: `${Math.max(2, (blocks / maxDailyBlocks) * 100)}%` }} />
                </div>
                <div className="min-w-[170px] text-right text-slate-500">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{blocks} blocks</span>
                  {' · '}{fmt(row.new_starters)} new · {fmt(row.conversions)} converted
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <h2 className="font-bold text-slate-900 dark:text-white">Trial performance by question bank</h2>
          <p className="mt-0.5 text-[10px] text-slate-500">Conversion attribution uses the bank where the user first consumed a trial block.</p>
        </div>
        {data.by_bank.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">No free-trial banks are configured.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/50">
                <tr><th className="px-4 py-3">Bank</th><th className="px-4 py-3">Limits</th><th className="px-4 py-3">Starters</th><th className="px-4 py-3">Active</th><th className="px-4 py-3">Blocks</th><th className="px-4 py-3">Converted</th><th className="px-4 py-3">Conversion</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.by_bank.map((bank) => (
                  <tr key={bank.bank_id}>
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">{bank.bank_name}</td>
                    <td className="px-4 py-3 text-slate-500">{bank.block_limit ?? '—'} blocks · {bank.question_limit} questions</td>
                    <td className="px-4 py-3">{fmt(bank.starters)}</td>
                    <td className="px-4 py-3">{fmt(bank.active_users)}</td>
                    <td className="px-4 py-3">{fmt(bank.blocks_consumed)}</td>
                    <td className="px-4 py-3 font-semibold text-emerald-600">{fmt(bank.converted_users)}</td>
                    <td className="px-4 py-3 font-semibold">{n(bank.conversion_rate_percent).toFixed(1)}%</td>
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
      {note && <p className="mt-1 text-[10px] leading-4 text-slate-400">{note}</p>}
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return <div className="mx-auto max-w-7xl rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{message}</div>;
}

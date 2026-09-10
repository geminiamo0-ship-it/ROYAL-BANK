import { Activity, Clock3, Gauge, Repeat2, Target, Users } from 'lucide-react';
import { getAdminProductAnalytics } from '@/actions/admin-intelligence';
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

export default async function ProductAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string | string[] }>;
}) {
  const params = await searchParams;
  const window = resolveIntelligenceWindow(params.days);
  const result = await getAdminProductAnalytics({ from: window.from, to: window.to });

  if (!result.ok) {
    return <ErrorCard message={result.error} />;
  }

  const data = result.data;
  const summary = data.summary;
  const maxDailyActive = Math.max(1, ...data.daily.map((row) => n(row.active_users)));

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-purple-600">Release D · Intelligence</p>
          <h1 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">Product Analytics</h1>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
            Student activity from real exam sessions and answers: active users, retention, completion, question usage and bank engagement.
          </p>
        </div>
        <IntelligenceWindowTabs baseHref="/admin/product-analytics" days={window.days} />
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <Metric icon={Activity} label="DAU" value={fmt(summary.dau)} note="Activity in the last 24 hours" />
        <Metric icon={Activity} label="WAU" value={fmt(summary.wau)} note="Activity in the last 7 days" />
        <Metric icon={Activity} label="MAU" value={fmt(summary.mau)} note="Activity in the last 30 days" />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Users} label="Active users" value={fmt(summary.active_users)} note={`${fmt(summary.returning_users)} active on 2+ days`} />
        <Metric icon={Gauge} label="Sessions started" value={fmt(summary.sessions_started)} note={`${fmt(summary.sessions_completed)} completed`} />
        <Metric icon={Target} label="Completion rate" value={`${n(summary.session_completion_rate_percent).toFixed(1)}%`} />
        <Metric icon={Repeat2} label="7-day retention" value={`${n(summary.retention_7d_percent).toFixed(1)}%`} note={`${fmt(summary.retained_7d_users)} / ${fmt(summary.retention_7d_cohort)} eligible new users`} />
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Metric icon={Users} label="New students" value={fmt(summary.new_users)} />
        <Metric icon={Target} label="Questions answered" value={fmt(summary.questions_answered)} note={`${n(summary.answer_accuracy_percent).toFixed(1)}% correct`} />
        <Metric icon={Clock3} label="Avg answer time" value={summary.avg_answer_seconds == null ? '—' : `${n(summary.avg_answer_seconds).toFixed(1)} s`} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4">
          <h2 className="font-bold text-slate-900 dark:text-white">Daily active usage</h2>
          <p className="mt-1 text-[10px] text-slate-500">Active means the user started a session or answered a question on that day.</p>
        </div>
        <div className="space-y-2">
          {data.daily.map((row) => {
            const active = n(row.active_users);
            return (
              <div key={row.date} className="grid grid-cols-[88px_1fr_auto] items-center gap-3 text-[11px]">
                <time className="font-medium text-slate-500">{new Date(`${row.date}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.max(2, (active / maxDailyActive) * 100)}%` }} />
                </div>
                <div className="min-w-[220px] text-right text-slate-500">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{active} active</span>
                  {' · '}{fmt(row.sessions_started)} sessions · {fmt(row.questions_answered)} answers · {n(row.accuracy_percent).toFixed(1)}%
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.45fr_0.85fr]">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-800">
            <h2 className="font-bold text-slate-900 dark:text-white">Engagement by question bank</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/50">
                <tr><th className="px-4 py-3">Bank</th><th className="px-4 py-3">Users</th><th className="px-4 py-3">Sessions</th><th className="px-4 py-3">Completion</th><th className="px-4 py-3">Answers</th><th className="px-4 py-3">Accuracy</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.by_bank.map((bank) => (
                  <tr key={bank.bank_id}>
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">{bank.bank_name}</td>
                    <td className="px-4 py-3">{fmt(bank.active_users)}</td>
                    <td className="px-4 py-3">{fmt(bank.sessions_started)}</td>
                    <td className="px-4 py-3">{n(bank.completion_rate_percent).toFixed(1)}%</td>
                    <td className="px-4 py-3">{fmt(bank.questions_answered)}</td>
                    <td className="px-4 py-3 font-semibold">{n(bank.accuracy_percent).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <h2 className="font-bold text-slate-900 dark:text-white">Session mode usage</h2>
          <div className="mt-4 space-y-3">
            {data.session_types.length === 0 ? (
              <p className="text-xs text-slate-500">No sessions started in this window.</p>
            ) : data.session_types.map((row) => (
              <div key={row.session_type} className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-slate-800 dark:text-slate-100">{row.session_type}</span>
                  <span className="text-slate-500">{fmt(row.sessions)} sessions</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className="h-full bg-emerald-600" style={{ width: `${Math.min(100, n(row.completion_rate_percent))}%` }} />
                </div>
                <p className="mt-1 text-[10px] text-slate-400">{n(row.completion_rate_percent).toFixed(1)}% completed</p>
              </div>
            ))}
          </div>
        </section>
      </div>
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

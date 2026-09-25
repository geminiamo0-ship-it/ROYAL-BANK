import { Bot, Clock3, Coins, Gauge, MessageCircle, Users } from 'lucide-react';
import { getDeepDiveAdminOverview } from '@/actions/deep-dive-admin';
import { DeepDiveAdminConfig } from '@/components/admin/DeepDiveAdminConfig';

function n(value: number | string | null | undefined) {
  return Number(value || 0);
}

function fmt(value: number | string | null | undefined) {
  return n(value).toLocaleString();
}

export default async function DeepDiveAdminPage() {
  const result = await getDeepDiveAdminOverview(30);
  if (!result.ok) {
    return (
      <div className="mx-auto max-w-7xl rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
        {result.error}
      </div>
    );
  }

  const data = result.data;
  const usage = data.usage;

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-16">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-purple-600">Deep Dive · AI Operations</p>
        <h1 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">AI Tutor Control</h1>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
          Live model configuration plus the last 30 days of cached Deep Dive and follow-up usage.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Users} label="AI users · 30d" value={fmt(usage.active_users)} note={`${fmt(usage.deep_dive_starts)} new Deep Dives`} />
        <Metric icon={MessageCircle} label="Follow-ups · 30d" value={fmt(usage.followup_messages)} note={`${fmt(usage.requests)} total AI events`} />
        <Metric icon={Gauge} label="Initial cache hit rate" value={`${n(usage.cache_hit_rate_percent).toFixed(1)}%`} note={`${fmt(usage.cache_hits)} cached starts`} />
        <Metric icon={Coins} label="OpenRouter cost · 30d" value={`$${n(usage.cost_usd).toFixed(4)}`} note={`${fmt(usage.input_tokens)} in · ${fmt(usage.output_tokens)} out tokens`} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <Metric icon={Clock3} label="Average AI latency" value={`${n(usage.avg_latency_ms).toFixed(0)} ms`} />
        <Metric icon={Bot} label="Primary model" value={data.config.primary_model || '—'} note={data.config.fallback_model ? `Fallback: ${data.config.fallback_model}` : 'No fallback configured'} />
      </section>

      <DeepDiveAdminConfig config={data.config} />

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <h2 className="font-bold text-slate-900 dark:text-white">Usage by model</h2>
          <p className="mt-0.5 text-[10px] text-slate-500">Actual model returned by OpenRouter, including fallback traffic.</p>
        </div>
        {data.models.length === 0 ? (
          <div className="p-5 text-xs text-slate-500">No Deep Dive AI usage has synced yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/50">
                <tr>
                  <th className="px-4 py-3">Model</th>
                  <th className="px-4 py-3">Requests</th>
                  <th className="px-4 py-3">Input tokens</th>
                  <th className="px-4 py-3">Output tokens</th>
                  <th className="px-4 py-3">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.models.map((row) => (
                  <tr key={row.model}>
                    <td className="px-4 py-3 font-mono text-[11px] font-semibold text-slate-900 dark:text-white">{row.model}</td>
                    <td className="px-4 py-3">{fmt(row.requests)}</td>
                    <td className="px-4 py-3">{fmt(row.input_tokens)}</td>
                    <td className="px-4 py-3">{fmt(row.output_tokens)}</td>
                    <td className="px-4 py-3 font-semibold">{`$${n(row.cost_usd).toFixed(4)}`}</td>
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
      <div className="flex items-center gap-2 text-slate-400">
        <Icon className="h-4 w-4" />
        <span className="text-[10px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 break-words text-xl font-black text-slate-900 dark:text-white">{value}</p>
      {note ? <p className="mt-1 text-[10px] leading-4 text-slate-400">{note}</p> : null}
    </div>
  );
}

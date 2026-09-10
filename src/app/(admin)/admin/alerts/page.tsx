import Link from 'next/link';
import { AlertCircle, AlertTriangle, Info, ShieldAlert } from 'lucide-react';
import { getAdminIntelligenceAlerts } from '@/actions/admin-intelligence';

function iconFor(severity: 'critical' | 'warning' | 'info') {
  if (severity === 'critical') return AlertCircle;
  if (severity === 'warning') return AlertTriangle;
  return Info;
}

function classesFor(severity: 'critical' | 'warning' | 'info') {
  if (severity === 'critical') {
    return 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200';
  }
  if (severity === 'warning') {
    return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200';
  }
  return 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200';
}

export default async function AlertsPage() {
  const result = await getAdminIntelligenceAlerts();

  if (!result.ok) {
    return <div className="mx-auto max-w-6xl rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{result.error}</div>;
  }

  const alerts = result.data;
  const critical = alerts.filter((alert) => alert.severity === 'critical').length;
  const warning = alerts.filter((alert) => alert.severity === 'warning').length;
  const info = alerts.filter((alert) => alert.severity === 'info').length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-16">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-purple-600">Release D · Intelligence</p>
        <h1 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">Live Alerts</h1>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
          Current conditions derived from production security, support, trial and product data. Alerts disappear automatically when the underlying condition is resolved.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <Summary label="Critical" value={critical} className="text-red-600" />
        <Summary label="Warnings" value={warning} className="text-amber-600" />
        <Summary label="Information" value={info} className="text-blue-600" />
      </section>

      {alerts.length === 0 ? (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center dark:border-emerald-900 dark:bg-emerald-950/30">
          <ShieldAlert className="mx-auto h-8 w-8 text-emerald-600" />
          <h2 className="mt-3 font-bold text-emerald-800 dark:text-emerald-200">No live alert conditions</h2>
          <p className="mt-1 text-xs text-emerald-700/80 dark:text-emerald-300/80">Current production thresholds are not being triggered.</p>
        </section>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => {
            const Icon = iconFor(alert.severity);
            return (
              <article key={alert.alert_key} className={`rounded-xl border p-5 ${classesFor(alert.severity)}`}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 gap-3">
                    <Icon className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-bold">{alert.title}</h2>
                        <span className="rounded-full border border-current/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide">{alert.severity}</span>
                      </div>
                      <p className="mt-1 text-xs leading-5 opacity-80">{alert.description}</p>
                      <p className="mt-2 text-[10px] opacity-60">Observed {new Date(alert.observed_at).toLocaleString()}</p>
                    </div>
                  </div>
                  <Link href={alert.href} className="shrink-0 rounded-lg bg-white/70 px-3 py-2 text-[11px] font-bold shadow-xs hover:bg-white dark:bg-slate-950/40 dark:hover:bg-slate-950/70">
                    Open source
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5 text-[11px] leading-5 text-slate-500 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <p className="font-semibold text-slate-700 dark:text-slate-200">Current automatic thresholds</p>
        <p className="mt-1">Manual-review or high-risk accounts, suspicious logins, ≥10 exam-security events/hour, paid upgrades waiting for activation, upgrade requests older than 24 hours, low completion with a meaningful session sample, and low trial conversion with at least 10 starters.</p>
      </section>
    </div>
  );
}

function Summary({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-black ${className}`}>{value}</p>
    </div>
  );
}

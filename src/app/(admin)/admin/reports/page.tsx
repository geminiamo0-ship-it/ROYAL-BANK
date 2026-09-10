import { Activity, AlertTriangle, Banknote, ShieldAlert, Sparkles, Users } from 'lucide-react';
import { getAdminIntelligenceReport } from '@/actions/admin-intelligence';
import {
  IntelligenceWindowTabs,
  resolveIntelligenceWindow,
} from '@/components/admin/IntelligenceWindowTabs';

function n(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fmt(value: unknown) {
  return n(value).toLocaleString();
}

type SupportSummary = {
  contacts?: number | string;
  activations?: number | string;
  payments_recorded?: number | string;
  avg_first_contact_minutes?: number | string | null;
  avg_activation_minutes?: number | string | null;
  open_backlog?: number | string;
  paid_awaiting_activation?: number | string;
};

type RevenueCurrency = {
  currency?: string;
  gross_collected?: number | string;
  refunds?: number | string;
  commissions?: number | string;
  contribution_profit?: number | string;
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string | string[] }>;
}) {
  const params = await searchParams;
  const window = resolveIntelligenceWindow(params.days);
  const result = await getAdminIntelligenceReport({ from: window.from, to: window.to });

  if (!result.ok) {
    return <div className="mx-auto max-w-7xl rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{result.error}</div>;
  }

  const report = result.data;
  const supportPayload = report.support as { summary?: SupportSummary };
  const revenuePayload = report.revenue as { currencies?: RevenueCurrency[] };
  const support = supportPayload.summary || {};
  const currencies = revenuePayload.currencies || [];

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-purple-600">Release D · Intelligence</p>
          <h1 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">Intelligence Reports</h1>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
            One server-side report combining trial, product, security, support and revenue data for the same reporting window.
          </p>
          <p className="mt-1 text-[10px] text-slate-400">Generated {new Date(report.generated_at).toLocaleString()}</p>
        </div>
        <IntelligenceWindowTabs baseHref="/admin/reports" days={window.days} />
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric icon={Sparkles} label="Trial starters" value={fmt(report.trial.summary.trial_starters)} note={`${n(report.trial.summary.conversion_rate_percent).toFixed(1)}% converted`} />
        <Metric icon={Users} label="Active users" value={fmt(report.product.summary.active_users)} note={`${fmt(report.product.summary.questions_answered)} answers`} />
        <Metric icon={Activity} label="Session completion" value={`${n(report.product.summary.session_completion_rate_percent).toFixed(1)}%`} />
        <Metric icon={ShieldAlert} label="Security events" value={fmt(report.security.summary.security_events)} note={`${fmt(report.security.summary.high_risk_accounts)} high-risk accounts`} />
        <Metric icon={AlertTriangle} label="Live alerts" value={fmt(report.alerts.length)} />
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <h2 className="font-bold text-slate-900 dark:text-white">Support operations</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
            <ReportRow label="Contacts" value={fmt(support.contacts)} />
            <ReportRow label="Activations" value={fmt(support.activations)} />
            <ReportRow label="Payments recorded" value={fmt(support.payments_recorded)} />
            <ReportRow label="Open backlog" value={fmt(support.open_backlog)} />
            <ReportRow label="Paid awaiting activation" value={fmt(support.paid_awaiting_activation)} />
            <ReportRow label="Avg first contact" value={support.avg_first_contact_minutes == null ? '—' : `${n(support.avg_first_contact_minutes).toFixed(1)} min`} />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2"><Banknote className="h-4 w-4 text-emerald-600" /><h2 className="font-bold text-slate-900 dark:text-white">Commercial by currency</h2></div>
          {currencies.length === 0 ? (
            <p className="mt-4 text-xs text-slate-500">No recorded revenue in this window.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {currencies.map((row, index) => (
                <div key={`${row.currency || 'currency'}-${index}`} className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
                  <p className="font-bold text-slate-800 dark:text-slate-100">{row.currency || 'Unknown currency'}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
                    <span>Collected <strong className="text-slate-800 dark:text-slate-200">{fmt(row.gross_collected)}</strong></span>
                    <span>Refunds <strong className="text-slate-800 dark:text-slate-200">{fmt(row.refunds)}</strong></span>
                    <span>Commissions <strong className="text-slate-800 dark:text-slate-200">{fmt(row.commissions)}</strong></span>
                    <span>Contribution <strong className="text-emerald-600">{fmt(row.contribution_profit)}</strong></span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        <ReportSection title="Trial funnel">
          <ReportRow label="Starters" value={fmt(report.trial.summary.trial_starters)} />
          <ReportRow label="Active trial users" value={fmt(report.trial.summary.active_trial_users)} />
          <ReportRow label="Exhausted trial users" value={fmt(report.trial.summary.exhausted_trial_users)} />
          <ReportRow label="Converted" value={fmt(report.trial.summary.converted_users)} />
          <ReportRow label="Conversion rate" value={`${n(report.trial.summary.conversion_rate_percent).toFixed(1)}%`} />
        </ReportSection>

        <ReportSection title="Product health">
          <ReportRow label="DAU / WAU / MAU" value={`${fmt(report.product.summary.dau)} / ${fmt(report.product.summary.wau)} / ${fmt(report.product.summary.mau)}`} />
          <ReportRow label="Returning users" value={fmt(report.product.summary.returning_users)} />
          <ReportRow label="Sessions" value={fmt(report.product.summary.sessions_started)} />
          <ReportRow label="Questions answered" value={fmt(report.product.summary.questions_answered)} />
          <ReportRow label="7-day retention" value={`${n(report.product.summary.retention_7d_percent).toFixed(1)}%`} />
        </ReportSection>

        <ReportSection title="Security posture">
          <ReportRow label="Manual review" value={fmt(report.security.summary.manual_review_accounts)} />
          <ReportRow label="High risk" value={fmt(report.security.summary.high_risk_accounts)} />
          <ReportRow label="Suspicious logins" value={fmt(report.security.summary.suspicious_logins)} />
          <ReportRow label="Blocked IPs" value={fmt(report.security.summary.blocked_ips)} />
          <ReportRow label="Gateway escalations" value={fmt(report.security.summary.gateway_escalated_accounts)} />
        </ReportSection>
      </section>

      <p className="text-[10px] leading-4 text-slate-400">
        Revenue is intentionally never summed across currencies. Trial conversion means a user&apos;s first recorded trial consumption was followed by an activated upgrade request.
      </p>
    </div>
  );
}

function Metric({ icon: Icon, label, value, note }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 text-slate-400"><Icon className="h-4 w-4" /><span className="text-[10px] font-semibold uppercase tracking-wide">{label}</span></div>
      <p className="mt-2 text-xl font-black text-slate-900 dark:text-white">{value}</p>
      {note && <p className="mt-1 text-[10px] text-slate-400">{note}</p>}
    </div>
  );
}

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <h2 className="font-bold text-slate-900 dark:text-white">{title}</h2>
      <div className="mt-4 space-y-2">{children}</div>
    </section>
  );
}

function ReportRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/50"><span className="text-slate-500">{label}</span><strong className="text-slate-900 dark:text-white">{value}</strong></div>;
}

import Link from 'next/link';
import { Activity, AlertTriangle, Ban, Radar, ShieldAlert, UserRoundCheck } from 'lucide-react';
import { getAdminSecurityRisk } from '@/actions/admin-intelligence';
import {
  IntelligenceWindowTabs,
  resolveIntelligenceWindow,
} from '@/components/admin/IntelligenceWindowTabs';
import {
  IpBlockForm,
  ManualReviewButton,
  UnblockIpButton,
} from '@/components/admin/SecurityRiskActions';

function n(value: number | string | null | undefined) {
  return Number(value || 0);
}

function fmt(value: number | string | null | undefined) {
  return n(value).toLocaleString();
}

function date(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function AdminSecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string | string[] }>;
}) {
  const params = await searchParams;
  const window = resolveIntelligenceWindow(params.days);
  const result = await getAdminSecurityRisk({ from: window.from, to: window.to });

  if (!result.ok) {
    return <div className="mx-auto max-w-7xl rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{result.error}</div>;
  }

  const data = result.data;
  const summary = data.summary;

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-purple-600">Release D · Intelligence</p>
          <h1 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">Security & Risk</h1>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
            Live exam-abuse state, gateway escalations, suspicious logins and audited IP controls. Risk scores come from Royal&apos;s existing security engine.
          </p>
        </div>
        <IntelligenceWindowTabs baseHref="/admin/security" days={window.days} />
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={UserRoundCheck} label="Manual review" value={fmt(summary.manual_review_accounts)} />
        <Metric icon={ShieldAlert} label="High risk" value={fmt(summary.high_risk_accounts)} note={`${fmt(summary.medium_risk_accounts)} medium-risk accounts`} />
        <Metric icon={Activity} label="Security events" value={fmt(summary.security_events)} note={`${fmt(summary.suspicious_logins)} suspicious logins`} />
        <Metric icon={Ban} label="Blocked IPs" value={fmt(summary.blocked_ips)} />
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Metric icon={Radar} label="Question cooldowns" value={fmt(summary.currently_question_blocked)} />
        <Metric icon={Radar} label="Session cooldowns" value={fmt(summary.currently_session_blocked)} />
        <Metric icon={AlertTriangle} label="Gateway escalations" value={fmt(summary.gateway_escalated_accounts)} />
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <h2 className="font-bold text-slate-900 dark:text-white">Risk accounts</h2>
          <p className="mt-0.5 text-[10px] text-slate-500">Accounts appear here only when the existing exam security engine has risk state, a cooldown, escalation or manual-review requirement.</p>
        </div>
        {data.accounts.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">No accounts currently have elevated security state.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/50">
                <tr><th className="px-4 py-3">User</th><th className="px-4 py-3">Risk</th><th className="px-4 py-3">Manual review</th><th className="px-4 py-3">Question block</th><th className="px-4 py-3">Session block</th><th className="px-4 py-3">Gateway</th><th className="px-4 py-3">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.accounts.map((account) => (
                  <tr key={account.user_id}>
                    <td className="px-4 py-3">
                      <Link href={`/admin/users/${account.user_id}`} className="font-semibold text-slate-900 hover:text-purple-600 dark:text-white">{account.full_name || account.email || account.user_id}</Link>
                      {account.email && <p className="mt-0.5 text-[10px] text-slate-400">{account.email}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${account.severity === 'critical' ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' : account.severity === 'high' ? 'bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300' : account.severity === 'medium' ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{account.risk_score} · {account.severity}</span>
                    </td>
                    <td className="max-w-[220px] px-4 py-3 text-slate-500">{account.manual_review_required ? account.manual_review_reason || 'Required' : 'No'}</td>
                    <td className="px-4 py-3 text-slate-500">{account.question_blocked_until ? <><p>{date(account.question_blocked_until)}</p><p className="text-[10px] text-slate-400">{account.question_block_reason}</p></> : '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{account.session_create_blocked_until ? <><p>{date(account.session_create_blocked_until)}</p><p className="text-[10px] text-slate-400">{account.session_create_block_reason}</p></> : '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{account.gateway_reject_count} rejects · {account.gateway_escalation_count} escalations</td>
                    <td className="px-4 py-3"><ManualReviewButton userId={account.user_id} required={account.manual_review_required} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <h2 className="font-bold text-slate-900 dark:text-white">Security event mix</h2>
          <div className="mt-4 space-y-2">
            {data.event_types.length === 0 ? <p className="text-xs text-slate-500">No exam security events in this window.</p> : data.event_types.map((row) => (
              <div key={row.event_type} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-800">
                <span className="font-medium text-slate-700 dark:text-slate-200">{row.event_type.replaceAll('_', ' ')}</span>
                <span className="font-bold text-slate-900 dark:text-white">{fmt(row.count)}</span>
              </div>
            ))}
          </div>
        </section>

        <IpBlockForm />
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <h2 className="font-bold text-slate-900 dark:text-white">Blocked IP addresses</h2>
        </div>
        {data.blocked_ips.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">No IP addresses are currently blocked.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/50"><tr><th className="px-4 py-3">IP</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3">Blocked by</th><th className="px-4 py-3">Blocked at</th><th className="px-4 py-3">Action</th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.blocked_ips.map((block) => (
                  <tr key={block.id}>
                    <td className="px-4 py-3 font-mono font-semibold">{block.ip_address}</td>
                    <td className="px-4 py-3 text-slate-500">{block.reason || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{block.blocked_by_name || block.blocked_by || 'system'}</td>
                    <td className="px-4 py-3 text-slate-500">{date(block.blocked_at)}</td>
                    <td className="px-4 py-3"><UnblockIpButton ip={block.ip_address} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-800"><h2 className="font-bold text-slate-900 dark:text-white">Recent security events</h2></div>
          <div className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
            {data.recent_events.length === 0 ? <p className="p-5 text-xs text-slate-500">No events in this window.</p> : data.recent_events.map((event) => (
              <div key={event.id} className="px-5 py-3 text-xs">
                <div className="flex items-start justify-between gap-3"><p className="font-semibold text-slate-800 dark:text-slate-100">{event.event_type.replaceAll('_', ' ')}</p><time className="text-[10px] text-slate-400">{date(event.occurred_at)}</time></div>
                <p className="mt-1 text-[10px] text-slate-500">{event.email || event.user_id || 'Unknown user'}{event.bank_name ? ` · ${event.bank_name}` : ''}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-800"><h2 className="font-bold text-slate-900 dark:text-white">Suspicious logins</h2></div>
          <div className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
            {data.suspicious_logins.length === 0 ? <p className="p-5 text-xs text-slate-500">No suspicious logins in this window.</p> : data.suspicious_logins.map((login) => (
              <div key={login.id} className="px-5 py-3 text-xs">
                <div className="flex items-start justify-between gap-3"><p className="font-semibold text-slate-800 dark:text-slate-100">{login.email || login.user_id || 'Unknown user'}</p><time className="text-[10px] text-slate-400">{date(login.login_at)}</time></div>
                <p className="mt-1 font-mono text-[10px] text-slate-500">{login.ip_address || 'No IP recorded'}</p>
                {login.user_agent && <p className="mt-1 line-clamp-2 text-[10px] text-slate-400">{login.user_agent}</p>}
              </div>
            ))}
          </div>
        </section>
      </div>
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

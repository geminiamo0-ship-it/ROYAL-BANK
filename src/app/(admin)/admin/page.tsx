import Link from 'next/link';
import {
  Activity,
  BadgePercent,
  Banknote,
  CircleDollarSign,
  Headphones,
  KeyRound,
  Users,
  WalletCards,
} from 'lucide-react';
import {
  getAdminRevenueSummary,
  listAdminCommissions,
  listAdminPromoCodes,
} from '@/actions/business-admin';
import { getAdminOperationsSummary } from '@/actions/admin-operations';

function money(value: number | string, currency: string) {
  return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`;
}

function count(value: number | string) {
  return Number(value || 0).toLocaleString();
}

function Card({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{value}</p>
      {note && <p className="mt-1 text-[11px] text-slate-400">{note}</p>}
    </div>
  );
}

export default async function AdminOverviewPage() {
  const [operationsResult, revenueResult, promosResult, commissionsResult] = await Promise.all([
    getAdminOperationsSummary(),
    getAdminRevenueSummary(),
    listAdminPromoCodes(),
    listAdminCommissions({ limit: 200 }),
  ]);

  const errors = [operationsResult, revenueResult, promosResult, commissionsResult]
    .filter((result) => !result.ok)
    .map((result) => (result.ok ? '' : result.error));

  if (errors.length > 0) {
    return (
      <div className="mx-auto max-w-7xl rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
        Unable to load the live business overview: {errors[0]}
      </div>
    );
  }

  if (!operationsResult.ok || !revenueResult.ok || !promosResult.ok || !commissionsResult.ok) return null;

  const operations = operationsResult.data;
  const revenue = revenueResult.data.currencies;
  const promos = promosResult.data;
  const commissions = commissionsResult.data;
  const approvedCommissions = commissions.filter((row) => row.status === 'approved');
  const activePromos = promos.filter((promo) => promo.status === 'active').length;

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-16 text-xs sm:text-sm">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-purple-600">Release C · Operations</p>
        <h1 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">Royal Business Overview</h1>
        <p className="text-xs text-slate-500">
          Live operational and commercial data only. Revenue stays separated by currency.
        </p>
      </div>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-purple-600" />
          <h2 className="font-bold text-slate-900 dark:text-white">Operations now</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card label="Active users" value={count(operations.active_users)} note={`${count(operations.inactive_users)} suspended · ${count(operations.new_users_30d)} new in 30d`} />
          <Card label="Active access grants" value={count(operations.active_grants)} note="Authoritative user_access_grants ledger" />
          <Card label="Open upgrade requests" value={count(operations.open_requests)} note={`${count(operations.pending_requests)} pending · ${count(operations.contacted_requests)} contacted`} />
          <Card label="Paid awaiting activation" value={count(operations.paid_awaiting_activation)} note={`${count(operations.activations_30d)} activations in 30d`} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Card label="Students" value={count(operations.student_users)} />
          <Card label="Support" value={count(operations.support_users)} />
          <Card label="Admins" value={count(operations.admin_users)} />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Banknote className="h-4 w-4 text-emerald-600" />
          <h2 className="font-bold text-slate-900 dark:text-white">Commercial · last 30 days</h2>
        </div>
        {revenue.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-500 dark:border-slate-800 dark:bg-slate-900">
            No recorded sales in the last 30 days yet. Upgrade requests can still be handled from the Support Activation portal.
          </div>
        ) : (
          <div className="space-y-4">
            {revenue.map((row) => (
              <section key={row.currency} className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{row.currency}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Card label="Cash collected · 30d" value={money(row.gross_collected, row.currency)} />
                  <Card label="Refunds · 30d" value={money(row.refunds, row.currency)} />
                  <Card label="Promo commissions · 30d" value={money(row.commissions, row.currency)} />
                  <Card
                    label="Contribution profit · 30d"
                    value={money(row.contribution_profit, row.currency)}
                    note="After refunds + promo commissions; before payroll, infrastructure, marketing and taxes"
                  />
                </div>
              </section>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card label="Active promo codes" value={activePromos.toLocaleString()} />
        <Card label="Approved commissions awaiting payout" value={approvedCommissions.length.toLocaleString()} />
        <Card
          label="Successful promo activations"
          value={promos.reduce((sum, promo) => sum + Number(promo.successful_activations || 0), 0).toLocaleString()}
        />
        <Card
          label="Unique promo-activated users"
          value={promos.reduce((sum, promo) => sum + Number(promo.activated_users || 0), 0).toLocaleString()}
          note="Per-promo sum; one customer may appear under more than one promo over time"
        />
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <QuickLink href="/admin/users" icon={Users} title="Users" note="Suspend, reactivate, roles and password recovery" />
        <QuickLink href="/admin/access" icon={KeyRound} title="Access Management" note="Grant ledger, expiry, extension and revocation" />
        <QuickLink href="/admin/support-performance" icon={Activity} title="Support Performance" note="Contacts, activation time, backlog and agents" />
        <QuickLink href="/support" icon={Headphones} title="Support Activation" note="Request → payment → access activation" />
        <QuickLink href="/admin/revenue" icon={CircleDollarSign} title="Revenue" note="Cash, refunds, commission cost and contribution" />
        <QuickLink href="/admin/promos" icon={BadgePercent} title="Promo Codes" note="Ownership, discounts and internal commission rules" />
        <QuickLink href="/admin/commissions" icon={WalletCards} title="Commissions" note="Approved, paid, reversed and settlements" />
      </section>
    </div>
  );
}

function QuickLink({
  href,
  icon: Icon,
  title,
  note,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  note: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-purple-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-purple-800"
    >
      <Icon className="h-5 w-5 text-purple-600" />
      <p className="mt-3 font-bold text-slate-900 dark:text-white">{title}</p>
      <p className="mt-1 text-[11px] leading-5 text-slate-500">{note}</p>
    </Link>
  );
}

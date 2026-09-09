import { Banknote, BadgePercent, CircleDollarSign, ReceiptText, RotateCcw, Users } from 'lucide-react';
import { getAdminRevenueSummary } from '@/actions/business-admin';
import type { AdminRevenueCurrencySummary } from '@/types/business-admin';

function money(value: number | string, currency: string) {
  const numeric = Number(value || 0);
  return `${numeric.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`;
}

function MetricCard({
  label,
  value,
  icon: Icon,
  note,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  note?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between text-slate-500">
        <span className="text-xs font-semibold">{label}</span>
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
      {note && <p className="mt-1 text-[11px] text-slate-400">{note}</p>}
    </div>
  );
}

function CurrencyPanel({ row }: { row: AdminRevenueCurrencySummary }) {
  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-5 dark:border-slate-800 dark:bg-slate-950/40">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-black text-slate-900 dark:text-white">{row.currency}</h2>
          <p className="text-[11px] text-slate-500">Commercial performance for this currency</p>
        </div>
        <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {Number(row.activations).toLocaleString()} activations
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Gross sales" value={money(row.gross_sales, row.currency)} icon={ReceiptText} note="Base prices before customer discounts" />
        <MetricCard label="Discounts" value={money(row.discounts, row.currency)} icon={BadgePercent} />
        <MetricCard label="Cash collected" value={money(row.gross_collected, row.currency)} icon={Banknote} note="Confirmed payments received in the selected period" />
        <MetricCard label="Refunds" value={money(row.refunds, row.currency)} icon={RotateCcw} />
        <MetricCard label="Net collected" value={money(row.net_collected, row.currency)} icon={CircleDollarSign} note="Collected cash minus refunds" />
        <MetricCard label="Promo commissions" value={money(row.commissions, row.currency)} icon={BadgePercent} note="Approved or already-paid affiliate commissions" />
        <MetricCard label="Contribution profit" value={money(row.contribution_profit, row.currency)} icon={CircleDollarSign} note="Net collected minus promo commissions; not final company net profit" />
        <MetricCard label="Unique paying customers" value={Number(row.unique_customers).toLocaleString()} icon={Users} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/60">
            <tr>
              <th className="px-4 py-3">Orders</th>
              <th className="px-4 py-3">Booked sales</th>
              <th className="px-4 py-3">Activations</th>
              <th className="px-4 py-3">Unique customers</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">{Number(row.orders_count).toLocaleString()}</td>
              <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">{money(row.booked_sales, row.currency)}</td>
              <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">{Number(row.activations).toLocaleString()}</td>
              <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">{Number(row.unique_customers).toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function AdminRevenuePage() {
  const result = await getAdminRevenueSummary();

  if (!result.ok) {
    return (
      <div className="mx-auto max-w-7xl rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
        {result.error}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-16 text-xs sm:text-sm">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Revenue & Contribution</h1>
        <p className="text-xs text-slate-500">
          Last 30 days. Every currency is kept separate so unrelated currencies are never added together.
        </p>
      </div>

      {result.data.currencies.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          No commercial activity has been recorded in the last 30 days.
        </div>
      ) : (
        <div className="space-y-5">
          {result.data.currencies.map((row) => (
            <CurrencyPanel key={row.currency} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, CircleDollarSign, RotateCcw, WalletCards } from 'lucide-react';
import {
  createAdminCommissionSettlement,
  refundAdminUpgradeOrder,
} from '@/actions/business-admin';
import type { AdminCommissionRow } from '@/types/business-admin';

interface CommissionAdminClientProps {
  initialRows: AdminCommissionRow[];
}

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-purple-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white';

function money(value: number | string, currency: string) {
  return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`;
}

function statusClass(status: AdminCommissionRow['status']) {
  if (status === 'approved') return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';
  if (status === 'paid') return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300';
  if (status === 'reversed') return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300';
  return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
}

export function CommissionAdminClient({ initialRows }: CommissionAdminClientProps) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<'all' | AdminCommissionRow['status']>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [paymentMethod, setPaymentMethod] = useState('InstaPay');
  const [reference, setReference] = useState('');
  const [settlementNotes, setSettlementNotes] = useState('');
  const [refundOrderId, setRefundOrderId] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [revokeAccess, setRevokeAccess] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const rows = useMemo(
    () => initialRows.filter((row) => statusFilter === 'all' || row.status === statusFilter),
    [initialRows, statusFilter],
  );

  const selectedRows = useMemo(
    () => initialRows.filter((row) => selected.includes(row.commission_id)),
    [initialRows, selected],
  );

  const selectionKey = useMemo(() => {
    const first = selectedRows[0];
    return first ? `${first.partner_user_id}:${first.currency}` : null;
  }, [selectedRows]);

  const selectedTotal = selectedRows.reduce((sum, row) => sum + Number(row.commission_amount || 0), 0);
  const selectedCurrency = selectedRows[0]?.currency || '';

  function toggle(row: AdminCommissionRow) {
    if (row.status !== 'approved') return;
    setError('');
    setMessage('');
    setSelected((current) => {
      if (current.includes(row.commission_id)) {
        return current.filter((id) => id !== row.commission_id);
      }

      const key = `${row.partner_user_id}:${row.currency}`;
      if (selectionKey && selectionKey !== key) {
        setError('A payout can contain only one coupon owner and one currency.');
        return current;
      }
      return [...current, row.commission_id];
    });
  }

  function settle() {
    setError('');
    setMessage('');
    if (selected.length === 0) {
      setError('Select at least one approved commission.');
      return;
    }
    if (paymentMethod.trim().length < 2) {
      setError('Enter the payout method.');
      return;
    }

    startTransition(async () => {
      const result = await createAdminCommissionSettlement({
        commissionIds: selected,
        paymentMethod,
        transactionReference: reference.trim() || undefined,
        notes: settlementNotes.trim() || undefined,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setMessage(
        `Settlement recorded: ${money(result.data.amount, result.data.currency)} across ${result.data.commission_count} commission(s).`,
      );
      setSelected([]);
      setReference('');
      setSettlementNotes('');
      router.refresh();
    });
  }

  function refund() {
    setError('');
    setMessage('');
    if (!refundOrderId.trim() || !refundReason.trim()) {
      setError('Enter an order ID and refund reason.');
      return;
    }

    startTransition(async () => {
      const result = await refundAdminUpgradeOrder({
        orderId: refundOrderId.trim(),
        reason: refundReason.trim(),
        revokeAccess,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setMessage(
        result.data.already_refunded
          ? 'This order was already refunded.'
          : `Refund recorded${result.data.refunded_amount != null && result.data.currency ? `: ${money(result.data.refunded_amount, result.data.currency)}` : ''}.`,
      );
      setRefundOrderId('');
      setRefundReason('');
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-16 text-xs sm:text-sm">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Promo Commissions</h1>
        <p className="text-xs text-slate-500">
          Internal finance ledger. Coupon owners cannot access commission amounts, settlements, customer identities, or payment data.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          {message}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center gap-2">
            <WalletCards className="h-4 w-4 text-purple-600" />
            <div>
              <h2 className="font-bold text-slate-900 dark:text-white">Create settlement</h2>
              <p className="text-[11px] text-slate-500">Select approved rows for one coupon owner and one currency.</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Payment method">
              <input className={inputClass} value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} />
            </Field>
            <Field label="Transaction reference">
              <input className={inputClass} value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Optional" />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Notes">
              <textarea className={`${inputClass} min-h-20 resize-y`} value={settlementNotes} onChange={(event) => setSettlementNotes(event.target.value)} placeholder="Optional internal note" />
            </Field>
          </div>

          <div className="mt-4 flex items-end justify-between gap-4 rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Selected</p>
              <p className="font-bold text-slate-900 dark:text-white">{selected.length} commission(s)</p>
              {selected.length > 0 && <p className="text-xs text-slate-500">{money(selectedTotal, selectedCurrency)}</p>}
            </div>
            <button
              type="button"
              disabled={isPending || selected.length === 0}
              onClick={settle}
              className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-xs font-bold text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              Mark payout paid
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-red-600" />
            <div>
              <h2 className="font-bold text-slate-900 dark:text-white">Full refund</h2>
              <p className="text-[11px] text-slate-500">Refunds reverse unpaid commission and can expire the linked access grant.</p>
            </div>
          </div>

          <div className="space-y-3">
            <Field label="Order ID">
              <input className={inputClass} value={refundOrderId} onChange={(event) => setRefundOrderId(event.target.value)} placeholder="UUID" />
            </Field>
            <Field label="Reason">
              <textarea className={`${inputClass} min-h-20 resize-y`} value={refundReason} onChange={(event) => setRefundReason(event.target.value)} placeholder="Required audit reason" />
            </Field>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={revokeAccess} onChange={(event) => setRevokeAccess(event.target.checked)} />
              Expire the access granted by this order
            </label>
          </div>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              disabled={isPending}
              onClick={refund}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              Record full refund
            </button>
          </div>
        </section>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <CircleDollarSign className="h-4 w-4 text-purple-600" />
            <h2 className="font-bold text-slate-900 dark:text-white">Commission ledger</h2>
          </div>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as 'all' | AdminCommissionRow['status'])}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          >
            <option value="all">All statuses</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
            <option value="reversed">Reversed</option>
            <option value="pending">Pending</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 dark:bg-slate-800/60">
              <tr>
                <th className="w-10 px-4 py-3">Pay</th>
                <th className="px-4 py-3">Coupon / owner</th>
                <th className="px-4 py-3">Commission</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Order ID</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Settlement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((row) => {
                const checked = selected.includes(row.commission_id);
                return (
                  <tr key={row.commission_id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Select commission ${row.commission_id}`}
                        checked={checked}
                        disabled={row.status !== 'approved'}
                        onChange={() => toggle(row)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-mono font-bold text-slate-900 dark:text-white">{row.promo_code}</p>
                      <p className="text-[11px] text-slate-500">{row.partner_name || row.partner_email}</p>
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">{money(row.commission_amount, row.currency)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusClass(row.status)}`}>{row.status}</span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        title="Use this order in the refund form"
                        onClick={() => setRefundOrderId(row.order_id)}
                        className="max-w-36 truncate font-mono text-[11px] text-purple-700 hover:underline dark:text-purple-300"
                      >
                        {row.order_id}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-[11px] text-slate-500">{new Date(row.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3 text-[11px] text-slate-500">
                      {row.settlement_id ? (
                        <span title={row.settlement_id}>Paid {row.settlement_paid_at ? new Date(row.settlement_paid_at).toLocaleDateString() : ''}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">No commissions match this filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5">
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

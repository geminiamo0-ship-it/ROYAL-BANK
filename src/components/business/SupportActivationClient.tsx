'use client';

import React, { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import {
  BadgeCheck,
  Banknote,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  Search,
  UserRound,
  XCircle,
} from 'lucide-react';
import {
  activateSupportUpgrade,
  cancelSupportUpgrade,
  getSupportUpgradeRequest,
  listSupportUpgradeRequests,
  markSupportUpgradeContacted,
  recordSupportUpgradePayment,
  saveSupportUpgradeOrder,
} from '@/actions/business';
import {
  ErrorBox,
  Field,
  InfoCard,
  MoneyField,
  RequestHeader,
  StatusBadge,
  SuccessBox,
  formatDate,
  formatMoney,
  formatPromoDiscount,
  inputClass,
} from '@/components/business/SupportActivationParts';
import type {
  SupportUpgradeDetail,
  SupportUpgradeQueueItem,
  UpgradeRequestStatus,
} from '@/types/business';

const STATUS_OPTIONS: Array<{ value: UpgradeRequestStatus | 'all'; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'paid', label: 'Paid' },
  { value: 'activated', label: 'Activated' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All' },
];

export function SupportActivationClient() {
  const [status, setStatus] = useState<UpgradeRequestStatus | 'all'>('pending');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<SupportUpgradeQueueItem[]>([]);
  const [detail, setDetail] = useState<SupportUpgradeDetail | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [duration, setDuration] = useState('6');
  const [basePrice, setBasePrice] = useState('');
  const [discount, setDiscount] = useState('0');
  const [agreedPrice, setAgreedPrice] = useState('');
  const [currency, setCurrency] = useState('EGP');
  const [orderNotes, setOrderNotes] = useState('');

  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('InstaPay');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [cancelReason, setCancelReason] = useState('');

  const refreshQueue = useCallback(async () => {
    setQueueError(null);
    const result = await listSupportUpgradeRequests({
      status: status === 'all' ? null : status,
      search,
      limit: 100,
      offset: 0,
    });

    if (!result.ok) {
      setItems([]);
      setQueueError(result.error);
      return;
    }

    setItems(result.data);
  }, [search, status]);

  useEffect(() => {
    let cancelled = false;

    void listSupportUpgradeRequests({
      status: status === 'all' ? null : status,
      search,
      limit: 100,
      offset: 0,
    }).then((result) => {
      if (cancelled) return;

      if (!result.ok) {
        setItems([]);
        setQueueError(result.error);
        return;
      }

      setQueueError(null);
      setItems(result.data);
    });

    return () => {
      cancelled = true;
    };
  }, [search, status]);

  const syncForms = useCallback((next: SupportUpgradeDetail) => {
    if (next.order) {
      setDuration(next.order.duration_months === null ? 'lifetime' : String(next.order.duration_months));
      setBasePrice(String(next.order.base_price));
      setDiscount(String(next.order.discount_amount));
      setAgreedPrice(String(next.order.agreed_price));
      setCurrency(next.order.currency);
      setOrderNotes(next.order.internal_notes || '');
      setPaymentAmount(String(next.order.amount_due));
    } else {
      setDuration('6');
      setBasePrice('');
      setDiscount('0');
      setAgreedPrice('');
      setCurrency('EGP');
      setOrderNotes('');
      setPaymentAmount('');
    }
    setPaymentReference('');
    setPaymentNotes('');
    setCancelReason('');
  }, []);

  const openRequest = useCallback(async (requestId: string, keepForms = false) => {
    setLoadingDetail(true);
    setActionError(null);
    const result = await getSupportUpgradeRequest(requestId);
    setLoadingDetail(false);

    if (!result.ok) {
      setActionError(result.error);
      return;
    }

    setDetail(result.data);
    if (!keepForms) syncForms(result.data);
  }, [syncForms]);

  async function refreshSelected(message?: string) {
    if (!detail) return;
    await Promise.all([refreshQueue(), openRequest(detail.request.id)]);
    if (message) setNotice(message);
  }

  function runAction(task: () => Promise<void>) {
    setActionError(null);
    setNotice(null);
    startTransition(() => {
      void task();
    });
  }

  const amountDue = useMemo(() => {
    if (!detail?.order) return 0;
    return Number(detail.order.amount_due || 0);
  }, [detail]);

  const canEditOrder = detail && ['pending', 'contacted'].includes(detail.request.status);
  const canRecordPayment = detail?.order && ['pending', 'contacted', 'paid'].includes(detail.request.status);
  const canActivate = detail?.request.status === 'paid' && amountDue <= 0;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-500">Operations</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">Support Activation</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Telegram-assisted sales: verify the request, record payment, then activate access.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refreshQueue()}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setStatus(option.value)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                status === option.value
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(searchDraft.trim());
          }}
          className="mt-3 flex gap-2"
        >
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Request ID, email, or name"
              className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-purple-500 dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <button type="submit" className="rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white dark:bg-slate-700">
            Search
          </button>
        </form>
      </section>

      {queueError && <ErrorBox message={queueError} />}
      {notice && <SuccessBox message={notice} />}
      {actionError && <ErrorBox message={actionError} />}

      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <p className="text-xs font-semibold text-slate-500">{items.length} requests</p>
          </div>
          <div className="max-h-[720px] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
            {items.length === 0 && !queueError ? (
              <div className="p-8 text-center text-sm text-slate-400">No matching requests.</div>
            ) : (
              items.map((item) => (
                <button
                  key={item.request_id}
                  type="button"
                  onClick={() => void openRequest(item.request_id)}
                  className={`w-full p-4 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
                    detail?.request.id === item.request_id ? 'bg-purple-50 dark:bg-purple-950/20' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-bold text-purple-600">{item.public_code}</p>
                      <p className="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-white">{item.full_name || item.email}</p>
                      <p className="truncate text-xs text-slate-500">{item.email}</p>
                    </div>
                    <StatusBadge status={item.request_status} />
                  </div>
                  <p className="mt-3 truncate text-xs font-medium text-slate-700 dark:text-slate-300">{item.product_name}</p>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                    <span>{item.promo_code ? `Promo ${item.promo_code}` : 'No promo'}</span>
                    <span>{formatDate(item.created_at)}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="min-h-[520px] rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {loadingDetail ? (
            <div className="flex min-h-[420px] items-center justify-center text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : !detail ? (
            <div className="flex min-h-[420px] flex-col items-center justify-center text-center text-slate-400">
              <UserRound className="mb-3 h-10 w-10" />
              <p className="text-sm">Select an upgrade request.</p>
            </div>
          ) : (
            <div className="space-y-5">
              <RequestHeader detail={detail} />

              <div className="grid gap-3 sm:grid-cols-3">
                <InfoCard label="Current status" value={detail.request.status} />
                <InfoCard label="Promo" value={detail.request.promo_code || 'None'} />
                <InfoCard label="Existing grants" value={String(detail.active_access.length)} />
              </div>

              {detail.promo && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
                  Promo {detail.promo.code}: {formatPromoDiscount(detail.promo)}. Commission details stay hidden from Support.
                </div>
              )}

              {detail.request.status === 'pending' && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => runAction(async () => {
                    const result = await markSupportUpgradeContacted(detail.request.id);
                    if (!result.ok) return setActionError(result.error);
                    await refreshSelected('Request marked as contacted.');
                  })}
                  className="inline-flex items-center gap-2 rounded-lg border border-purple-300 px-3 py-2 text-xs font-semibold text-purple-700 hover:bg-purple-50 disabled:opacity-50 dark:border-purple-800 dark:text-purple-300"
                >
                  <Clock3 className="h-4 w-4" />
                  Mark contacted
                </button>
              )}

              <div className="grid gap-5 xl:grid-cols-2">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!canEditOrder) return;
                    runAction(async () => {
                      const result = await saveSupportUpgradeOrder({
                        requestId: detail.request.id,
                        durationMonths: duration === 'lifetime' ? null : Number(duration),
                        basePrice: Number(basePrice),
                        discountAmount: Number(discount),
                        agreedPrice: Number(agreedPrice),
                        currency,
                        internalNotes: orderNotes || undefined,
                      });
                      if (!result.ok) return setActionError(result.error);
                      await refreshSelected('Order saved. Payment can now be recorded.');
                    });
                  }}
                  className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"
                >
                  <div className="mb-4 flex items-center gap-2">
                    <Banknote className="h-4 w-4 text-emerald-500" />
                    <h2 className="text-sm font-bold">Order</h2>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Duration">
                      <select value={duration} onChange={(event) => setDuration(event.target.value)} disabled={!canEditOrder} className={inputClass}>
                        <option value="1">1 month</option>
                        <option value="3">3 months</option>
                        <option value="6">6 months</option>
                        <option value="12">12 months</option>
                        <option value="lifetime">Lifetime</option>
                      </select>
                    </Field>
                    <Field label="Currency">
                      <input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} maxLength={3} disabled={!canEditOrder} className={inputClass} />
                    </Field>
                    <MoneyField label="Base price" value={basePrice} setValue={setBasePrice} disabled={!canEditOrder} />
                    <MoneyField label="Discount" value={discount} setValue={setDiscount} disabled={!canEditOrder} />
                    <div className="sm:col-span-2">
                      <MoneyField label="Final agreed price" value={agreedPrice} setValue={setAgreedPrice} disabled={!canEditOrder} />
                    </div>
                  </div>
                  <Field label="Internal note">
                    <textarea value={orderNotes} onChange={(event) => setOrderNotes(event.target.value)} disabled={!canEditOrder} rows={2} className={`${inputClass} h-auto py-2`} />
                  </Field>
                  <button type="submit" disabled={!canEditOrder || isPending} className="mt-3 w-full rounded-lg bg-slate-900 py-2.5 text-xs font-semibold text-white disabled:opacity-40 dark:bg-slate-700">
                    {detail.order ? 'Update order' : 'Create order'}
                  </button>
                </form>

                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!canRecordPayment) return;
                    runAction(async () => {
                      const result = await recordSupportUpgradePayment({
                        requestId: detail.request.id,
                        amount: Number(paymentAmount),
                        currency: detail.order?.currency || currency,
                        paymentMethod,
                        transactionReference: paymentReference || undefined,
                        notes: paymentNotes || undefined,
                      });
                      if (!result.ok) return setActionError(result.error);
                      await refreshSelected(result.data.paid_enough ? 'Payment confirmed. Request is ready to activate.' : 'Partial payment recorded.');
                    });
                  }}
                  className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <BadgeCheck className="h-4 w-4 text-blue-500" />
                      <h2 className="text-sm font-bold">Payment</h2>
                    </div>
                    {detail.order && <span className="text-xs font-semibold text-slate-500">Due {formatMoney(detail.order.amount_due, detail.order.currency)}</span>}
                  </div>
                  <MoneyField label="Amount received" value={paymentAmount} setValue={setPaymentAmount} disabled={!canRecordPayment} />
                  <Field label="Payment method">
                    <input value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} disabled={!canRecordPayment} placeholder="InstaPay" className={inputClass} />
                  </Field>
                  <Field label="Transaction reference">
                    <input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} disabled={!canRecordPayment} className={inputClass} />
                  </Field>
                  <Field label="Payment note">
                    <textarea value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} disabled={!canRecordPayment} rows={2} className={`${inputClass} h-auto py-2`} />
                  </Field>
                  <button type="submit" disabled={!canRecordPayment || isPending} className="mt-3 w-full rounded-lg bg-blue-600 py-2.5 text-xs font-semibold text-white disabled:opacity-40">
                    Confirm payment
                  </button>
                </form>
              </div>

              {detail.payments.length > 0 && (
                <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <h2 className="mb-3 text-sm font-bold">Payment history</h2>
                  <div className="space-y-2">
                    {detail.payments.map((payment) => (
                      <div key={payment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-950">
                        <span className="font-semibold">{formatMoney(payment.amount, payment.currency)}</span>
                        <span className="text-slate-500">{payment.payment_method}{payment.transaction_reference ? ` · ${payment.transaction_reference}` : ''}</span>
                        <span className="text-slate-400">{formatDate(payment.paid_at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-5 dark:border-slate-800">
                <button
                  type="button"
                  disabled={!canActivate || isPending}
                  onClick={() => runAction(async () => {
                    const result = await activateSupportUpgrade(detail.request.id);
                    if (!result.ok) return setActionError(result.error);
                    await refreshSelected(result.data.already_activated ? 'Access was already activated.' : 'Payment verified and Royal access activated.');
                  })}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Activate access
                </button>

                {!['paid', 'activated', 'cancelled'].includes(detail.request.status) && (
                  <div className="flex min-w-[260px] flex-1 gap-2">
                    <input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Cancellation reason" className={inputClass} />
                    <button
                      type="button"
                      disabled={!cancelReason.trim() || isPending}
                      onClick={() => runAction(async () => {
                        const result = await cancelSupportUpgrade({ requestId: detail.request.id, reason: cancelReason });
                        if (!result.ok) return setActionError(result.error);
                        await refreshSelected('Upgrade request cancelled.');
                      })}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3 text-xs font-semibold text-red-600 disabled:opacity-40 dark:border-red-900 dark:text-red-300"
                    >
                      <XCircle className="h-4 w-4" />
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              {detail.request.status === 'activated' && detail.request.access_grant_id && (
                <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                  Active grant #{detail.request.access_grant_id}. user_access_grants remains the entitlement authority.
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

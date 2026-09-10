'use client';

import React, { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import {
  BadgeCheck,
  Banknote,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Search,
  UserRound,
  X,
  XCircle,
} from 'lucide-react';
import {
  activateSupportUpgrade,
  cancelSupportUpgrade,
  getSupportUpgradeRequest,
  listSupportUpgradeRequests,
  recordSupportUpgradePayment,
  saveSupportUpgradeOrder,
} from '@/actions/business';
import {
  ErrorBox,
  Field,
  InfoCard,
  MoneyField,
  ProgressStrip,
  RequestHeader,
  SuccessBox,
  formatMoney,
  formatPromoDiscount,
  inputClass,
  visibleStatus,
} from '@/components/business/SupportActivationParts';
import { SupportRequestQueue } from '@/components/business/SupportRequestQueue';
import type { SupportUpgradeDetail, SupportUpgradeQueueItem } from '@/types/business';

type QueueFilter = 'pending' | 'paid' | 'activated' | 'cancelled' | 'all';

const FILTERS: Array<{ value: QueueFilter; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'paid', label: 'Paid' },
  { value: 'activated', label: 'Activated' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All' },
];

export function SupportActivationClient() {
  const [status, setStatus] = useState<QueueFilter>('pending');
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

  const loadQueue = useCallback(async () => {
    setQueueError(null);

    if (!search && status === 'pending') {
      const [pendingResult, contactedResult] = await Promise.all([
        listSupportUpgradeRequests({ status: 'pending', search: '', limit: 100, offset: 0 }),
        listSupportUpgradeRequests({ status: 'contacted', search: '', limit: 100, offset: 0 }),
      ]);
      if (!pendingResult.ok) return setQueueError(pendingResult.error);
      if (!contactedResult.ok) return setQueueError(contactedResult.error);
      setItems(
        [...pendingResult.data, ...contactedResult.data]
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
      );
      return;
    }

    const result = await listSupportUpgradeRequests({
      status: search || status === 'all' ? null : status,
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
    void loadQueue();
  }, [loadQueue]);

  const syncForms = useCallback((next: SupportUpgradeDetail) => {
    if (next.order) {
      setDuration(next.order.duration_months === null ? 'lifetime' : String(next.order.duration_months));
      setBasePrice(String(next.order.base_price));
      setDiscount(String(next.order.discount_amount));
      setAgreedPrice(String(next.order.agreed_price));
      setCurrency(next.order.currency);
      setOrderNotes(next.order.internal_notes || '');
      setPaymentAmount(String(next.order.amount_due));
    } else if (next.quote) {
      setDuration(next.quote.duration_months === null ? 'lifetime' : String(next.quote.duration_months));
      setBasePrice(next.quote.base_price === null ? '' : String(next.quote.base_price));
      setDiscount(next.quote.discount_amount === null ? '0' : String(next.quote.discount_amount));
      setAgreedPrice(next.quote.final_price === null ? '' : String(next.quote.final_price));
      setCurrency(next.quote.currency || 'EGP');
      setOrderNotes('');
      setPaymentAmount(next.quote.final_price === null ? '' : String(next.quote.final_price));
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

  const openRequest = useCallback(async (requestId: string) => {
    setLoadingDetail(true);
    setActionError(null);
    const result = await getSupportUpgradeRequest(requestId);
    setLoadingDetail(false);
    if (!result.ok) return setActionError(result.error);
    setDetail(result.data);
    syncForms(result.data);
  }, [syncForms]);

  async function refreshSelected(message?: string) {
    if (!detail) return;
    const result = await getSupportUpgradeRequest(detail.request.id);
    await loadQueue();
    if (!result.ok) return setActionError(result.error);
    setDetail(result.data);
    syncForms(result.data);
    if (message) setNotice(message);
  }

  function runAction(task: () => Promise<void>) {
    setActionError(null);
    setNotice(null);
    startTransition(() => void task());
  }

  const amountDue = useMemo(() => Number(detail?.order?.amount_due || 0), [detail]);
  const canEditOrder = Boolean(detail && ['pending', 'contacted'].includes(detail.request.status));
  const catalogDurationLocked = Boolean(detail?.quote);
  const catalogPriceLocked = detail?.quote?.price_locked === true;
  const canRecordPayment = Boolean(
    detail?.order && ['pending', 'contacted', 'paid'].includes(detail.request.status) && amountDue > 0,
  );
  const canActivate = detail?.request.status === 'paid' && amountDue <= 0;

  return (
    <div className="min-h-screen bg-[#07101d] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px] space-y-5">
        <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-purple-400">Operations</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-white">Support Activation</h1>
            <p className="mt-1 text-sm font-medium text-slate-400">Record the sale, manually verify payment, then manually activate or extend access.</p>
          </div>

          <div className="flex w-full max-w-2xl gap-2">
            <form
              className="flex min-w-0 flex-1 gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const query = searchDraft.trim();
                setSearch(query);
                if (query) setStatus('all');
              }}
            >
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder="Search request ID, email, or name..."
                  className="h-11 w-full rounded-xl border border-slate-700 bg-[#0b1627] pl-10 pr-10 text-sm font-medium text-white outline-none placeholder:text-slate-500 focus:border-purple-500"
                />
                {searchDraft && (
                  <button
                    type="button"
                    onClick={() => { setSearchDraft(''); setSearch(''); }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <button type="submit" className="rounded-xl bg-purple-600 px-5 text-xs font-black text-white hover:bg-purple-500">Search</button>
            </form>
            <button
              type="button"
              onClick={() => void loadQueue()}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-700 bg-[#0b1627] px-4 text-xs font-bold text-slate-200 hover:border-slate-500"
            >
              <RefreshCw className="h-4 w-4" />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </header>

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => { setStatus(option.value); setSearch(''); setSearchDraft(''); }}
              className={`rounded-full border px-4 py-2 text-xs font-black transition ${
                status === option.value && !search
                  ? 'border-purple-400 bg-purple-600 text-white'
                  : 'border-slate-700 bg-[#0b1627] text-slate-300 hover:border-slate-500 hover:text-white'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {queueError && <ErrorBox message={queueError} />}
        {notice && <SuccessBox message={notice} />}
        {actionError && <ErrorBox message={actionError} />}

        <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
          <SupportRequestQueue
            items={items}
            selectedId={detail?.request.id}
            queueError={queueError}
            onOpen={(requestId) => void openRequest(requestId)}
          />

          <section className="min-h-[620px] rounded-2xl border border-slate-800 bg-[#0b1627] p-5 shadow-2xl shadow-black/20 sm:p-6">
            {loadingDetail ? (
              <div className="flex min-h-[520px] items-center justify-center text-slate-500"><Loader2 className="h-7 w-7 animate-spin" /></div>
            ) : !detail ? (
              <div className="flex min-h-[520px] flex-col items-center justify-center text-center text-slate-500">
                <UserRound className="mb-3 h-11 w-11" />
                <p className="text-sm font-semibold">Select a request to manage it.</p>
              </div>
            ) : (
              <div className="space-y-5">
                <RequestHeader detail={detail} />
                <ProgressStrip status={detail.request.status} />

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <InfoCard label="Current status" value={visibleStatus(detail.request.status)} />
                  <InfoCard label="Promo" value={detail.request.promo_code || 'None'} />
                  <InfoCard label="Existing grants" value={String(detail.active_access.length)} />
                  <InfoCard label="Requested product" value={detail.request.product_name} />
                </div>

                {detail.quote && (
                  <div className="rounded-xl border border-purple-500/25 bg-purple-500/10 px-4 py-3 text-xs font-semibold text-purple-100">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        Catalog {detail.quote.mode === 'extension' ? 'extension' : 'upgrade'} · {detail.quote.plan_name || 'Plan'} · {detail.quote.duration_months === null ? 'Lifetime' : `${detail.quote.duration_months} months`}
                      </span>
                      <span className={catalogPriceLocked ? 'text-emerald-300' : 'text-amber-300'}>
                        {catalogPriceLocked ? 'Published quote locked' : 'Price set manually by Support'}
                      </span>
                    </div>
                    {catalogPriceLocked && (
                      <p className="mt-2 text-purple-200/80">
                        Customer quote: {formatMoney(detail.quote.final_price, detail.quote.currency)}. Duration, currency, and published price cannot be changed here.
                      </p>
                    )}
                  </div>
                )}

                {detail.promo && (
                  <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-xs font-semibold text-blue-200">
                    Promo {detail.promo.code}: {formatPromoDiscount(detail.promo)}.
                  </div>
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
                        await refreshSelected('Order saved. Payment still requires manual verification.');
                      });
                    }}
                    className="rounded-2xl border border-slate-800 bg-[#0a1424] p-4"
                  >
                    <div className="mb-4 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Banknote className="h-4 w-4 text-purple-400" />
                        <h2 className="text-sm font-black text-white">Order details</h2>
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Manual sale</span>
                    </div>
                    <div className="grid gap-x-3 sm:grid-cols-2">
                      <Field label="Duration">
                        <select
                          value={duration}
                          onChange={(event) => setDuration(event.target.value)}
                          disabled={!canEditOrder || catalogDurationLocked}
                          className={inputClass}
                        >
                          <option value="1">1 month</option>
                          <option value="3">3 months</option>
                          <option value="6">6 months</option>
                          <option value="12">12 months</option>
                          <option value="lifetime">Lifetime</option>
                        </select>
                      </Field>
                      <Field label="Currency">
                        <input
                          value={currency}
                          onChange={(event) => setCurrency(event.target.value.toUpperCase())}
                          maxLength={3}
                          disabled={!canEditOrder || catalogDurationLocked}
                          className={inputClass}
                        />
                      </Field>
                      <MoneyField label="Base price" value={basePrice} setValue={setBasePrice} disabled={!canEditOrder || catalogPriceLocked} />
                      <MoneyField label="Discount" value={discount} setValue={setDiscount} disabled={!canEditOrder || catalogPriceLocked} />
                      <div className="sm:col-span-2">
                        <MoneyField label="Final agreed price" value={agreedPrice} setValue={setAgreedPrice} disabled={!canEditOrder || catalogPriceLocked} />
                      </div>
                    </div>
                    <Field label="Internal note">
                      <textarea value={orderNotes} onChange={(event) => setOrderNotes(event.target.value)} disabled={!canEditOrder} rows={2} className={`${inputClass} h-auto py-2`} />
                    </Field>
                    {canEditOrder && (
                      <button type="submit" disabled={isPending} className="mt-1 h-11 w-full rounded-xl bg-purple-600 text-xs font-black text-white hover:bg-purple-500 disabled:opacity-40">
                        {detail.order ? 'Save order changes' : 'Create order'}
                      </button>
                    )}
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
                        await refreshSelected(result.data.paid_enough ? 'Payment manually confirmed. Ready for manual activation.' : 'Partial payment manually recorded.');
                      });
                    }}
                    className="rounded-2xl border border-slate-800 bg-[#0a1424] p-4"
                  >
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2"><BadgeCheck className="h-4 w-4 text-blue-400" /><h2 className="text-sm font-black text-white">Payment details</h2></div>
                      <span className={`text-xs font-black ${amountDue <= 0 ? 'text-emerald-300' : 'text-amber-300'}`}>Due {formatMoney(detail.order?.amount_due, detail.order?.currency || currency)}</span>
                    </div>
                    {!detail.order ? (
                      <div className="rounded-xl border border-slate-800 bg-[#081120] p-5 text-sm font-medium text-slate-400">Create the order first. No payment is recorded automatically.</div>
                    ) : (
                      <>
                        <MoneyField label="Amount received" value={paymentAmount} setValue={setPaymentAmount} disabled={!canRecordPayment} />
                        <Field label="Payment method"><input value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} disabled={!canRecordPayment} placeholder="InstaPay" className={inputClass} /></Field>
                        <Field label="Transaction reference"><input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} disabled={!canRecordPayment} placeholder="Optional reference" className={inputClass} /></Field>
                        <Field label="Payment note"><textarea value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} disabled={!canRecordPayment} rows={2} className={`${inputClass} h-auto py-2`} /></Field>
                        {canRecordPayment && <button type="submit" disabled={isPending} className="mt-1 h-11 w-full rounded-xl bg-blue-600 text-xs font-black text-white hover:bg-blue-500 disabled:opacity-40">Confirm payment manually</button>}
                      </>
                    )}
                  </form>
                </div>

                {canActivate && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => runAction(async () => {
                      const result = await activateSupportUpgrade(detail.request.id);
                      if (!result.ok) return setActionError(result.error);
                      const action = detail.quote?.mode === 'extension' ? 'extended' : 'activated';
                      await refreshSelected(result.data.already_activated ? 'Access was already active.' : `Payment verified and Royal access ${action}.`);
                    })}
                    className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-black text-white hover:bg-emerald-500 disabled:opacity-40"
                  >
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                    {detail.quote?.mode === 'extension' ? 'Extend Royal access' : 'Activate Royal access'}
                  </button>
                )}

                {detail.request.status === 'activated' && (
                  <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-4 text-emerald-100">
                    <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                    <div><p className="text-sm font-black">Access active</p><p className="mt-0.5 text-xs font-medium text-emerald-200/80">Grant #{detail.request.access_grant_id} is the authoritative Royal access record.</p></div>
                  </div>
                )}

                {detail.payments.length > 0 && (
                  <div className="rounded-2xl border border-slate-800 bg-[#0a1424] p-4">
                    <h2 className="mb-3 text-sm font-black text-white">Payment history</h2>
                    <div className="space-y-2">
                      {detail.payments.map((payment) => (
                        <div key={payment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-[#081120] px-3 py-3 text-xs">
                          <span className="font-black text-slate-100">{formatMoney(payment.amount, payment.currency)}</span>
                          <span className="font-medium text-slate-400">{payment.payment_method}{payment.transaction_reference ? ` · ${payment.transaction_reference}` : ''}</span>
                          <span className="font-medium text-slate-500">{new Date(payment.paid_at).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {['pending', 'contacted'].includes(detail.request.status) && (
                  <div className="flex flex-col gap-2 border-t border-slate-800 pt-4 sm:flex-row">
                    <input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Cancellation reason" className={inputClass} />
                    <button
                      type="button"
                      disabled={!cancelReason.trim() || isPending}
                      onClick={() => runAction(async () => {
                        const result = await cancelSupportUpgrade({ requestId: detail.request.id, reason: cancelReason });
                        if (!result.ok) return setActionError(result.error);
                        await refreshSelected('Upgrade request cancelled.');
                      })}
                      className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-red-500/30 px-4 text-xs font-black text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                    >
                      <XCircle className="h-4 w-4" /> Cancel request
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  cancelCatalogUpgradeRequest,
  createCatalogUpgradeRequest,
  getCatalogUpgradeOffer,
  previewCatalogQuote,
} from '@/actions/catalog';
import type {
  CatalogProductType,
  CatalogQuotePreview,
  CatalogUpgradeOffer,
  CatalogUpgradeReceipt,
} from '@/types/catalog';

interface Props {
  scopeType: CatalogProductType;
  targetId?: number | null;
  label?: string;
  className?: string;
  autoOpen?: boolean;
  supportUrl?: string | null;
}

function money(value: number | string | null, currency: string | null) {
  if (value === null || !currency) return null;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return null;
  return `${number.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`;
}

function planLabel(months: number | null) {
  if (months === null) return 'Lifetime';
  return `${months} ${months === 1 ? 'month' : 'months'}`;
}

export default function UpgradeModalTrigger({
  scopeType,
  targetId = null,
  label = 'Upgrade',
  className = 'border border-[#1eb34a] px-[8px] py-[4px] text-[12px] font-medium leading-none text-[#0a8e31] hover:bg-[#effbf3]',
  autoOpen = false,
  supportUrl = null,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [offer, setOffer] = useState<CatalogUpgradeOffer | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const [promoCode, setPromoCode] = useState('');
  const [quote, setQuote] = useState<CatalogQuotePreview | null>(null);
  const [receipt, setReceipt] = useState<CatalogUpgradeReceipt | null>(null);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState('');

  const targetKey = targetId ?? 0;
  const selectedPlan = useMemo(
    () => offer?.plans.find((plan) => plan.id === selectedPlanId) || null,
    [offer, selectedPlanId],
  );

  const openModal = () => {
    setOpen(true);
    setError('');
    setReceipt(null);
    startTransition(async () => {
      const result = await getCatalogUpgradeOffer({ scopeType, targetId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOffer(result.data);
      const preferred = result.data.plans.find((plan) => plan.is_default)
        || result.data.plans.find((plan) => plan.is_recommended)
        || result.data.plans[0]
        || null;
      setSelectedPlanId(result.data.pending_request?.catalog_plan_id || preferred?.id || null);
      setPromoCode(result.data.pending_request?.promo_code || '');
      setChanging(false);
      setQuote(null);
    });
  };

  useEffect(() => {
    if (autoOpen) openModal();
    // Auto-open only once for compatibility redirects from /upgrade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);

  const close = () => {
    if (isPending) return;
    setOpen(false);
    setOffer(null);
    setReceipt(null);
    setError('');
    setQuote(null);
    setChanging(false);
  };

  const applyPromo = () => {
    if (!selectedPlanId) return;
    setError('');
    startTransition(async () => {
      const result = await previewCatalogQuote({ planId: selectedPlanId, promoCode });
      if (!result.ok) {
        setQuote(null);
        setError(result.error);
        return;
      }
      setQuote(result.data);
    });
  };

  const submit = () => {
    if (!selectedPlanId) return;
    setError('');
    startTransition(async () => {
      const result = await createCatalogUpgradeRequest({
        planId: selectedPlanId,
        promoCode,
        replaceRequestId: changing ? offer?.pending_request?.request_id || null : null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setReceipt(result.data);
      setChanging(false);
      router.refresh();
    });
  };

  const cancelRequest = () => {
    const requestId = offer?.pending_request?.request_id;
    if (!requestId) return;
    setError('');
    startTransition(async () => {
      const result = await cancelCatalogUpgradeRequest(requestId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOffer(null);
      setOpen(false);
      router.refresh();
    });
  };

  const visibleQuote = quote || (selectedPlan ? {
    price_visible: selectedPlan.price_visible,
    base_price: selectedPlan.price,
    discount_amount: null,
    final_price: selectedPlan.price,
    currency: selectedPlan.currency,
    promo_applied: false,
  } : null);

  return (
    <>
      <button type="button" onClick={openModal} className={className}>{label}</button>
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/45 sm:items-center sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-label="Royal upgrade"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) close();
          }}
        >
          <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:max-w-[540px] sm:rounded-xl">
            <div className="sticky top-0 z-10 flex items-start justify-between border-b border-[#e5e7eb] bg-white px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#0076a8]">Royal access</p>
                <h2 className="mt-1 text-[19px] font-semibold text-[#111827]">{offer?.product.name || 'Upgrade options'}</h2>
                {offer?.product.scope_description && <p className="mt-1 text-[12px] text-[#667085]">{offer.product.scope_description}</p>}
              </div>
              <button type="button" onClick={close} className="rounded px-2 py-1 text-xl text-[#667085] hover:bg-[#f3f4f6]" aria-label="Close">×</button>
            </div>

            <div className="space-y-5 p-5">
              {isPending && !offer && <p className="text-sm text-[#667085]">Loading upgrade options…</p>}
              {error && <div className="rounded-md border border-[#f2b8b5] bg-[#fff4f3] px-3 py-2 text-[13px] text-[#9f1c17]">{error}</div>}

              {receipt ? (
                <div className="rounded-lg border border-[#a6dfba] bg-[#f2fff6] p-4">
                  <h3 className="text-[16px] font-semibold text-[#126b32]">Request submitted</h3>
                  <p className="mt-2 text-[13px] text-[#334155]">Your request code is <strong>{receipt.public_code}</strong>. Royal Support will verify payment manually and activate access manually.</p>
                  <p className="mt-2 text-[12px] text-[#667085]">{receipt.plan_name} · {planLabel(receipt.duration_months)}</p>
                  {receipt.price_visible
                    ? <p className="mt-1 text-[14px] font-semibold text-[#111827]">{money(receipt.final_price, receipt.currency)}</p>
                    : <p className="mt-1 text-[13px] font-medium text-[#111827]">Support will confirm the price with you.</p>}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {supportUrl && (
                      <a href={supportUrl} target="_blank" rel="noreferrer" className="rounded bg-[#229ED9] px-4 py-2 text-[13px] font-semibold text-white">Contact Support on Telegram</a>
                    )}
                    <button type="button" onClick={close} className="rounded bg-[#0076a8] px-4 py-2 text-[13px] font-semibold text-white">Done</button>
                  </div>
                </div>
              ) : offer ? (
                <>
                  {offer.access.has_access && (
                    <div className="rounded-md border border-[#ccebd6] bg-[#f4fcf7] p-3 text-[13px] text-[#245f37]">
                      {offer.access.is_lifetime
                        ? 'Lifetime access is active.'
                        : <>Access active until <strong>{offer.access.expires_at ? new Date(offer.access.expires_at).toLocaleDateString() : '—'}</strong>{offer.access.expires_soon ? ' · Expires soon' : ''}</>}
                    </div>
                  )}

                  {offer.pending_request && !changing ? (
                    <div className="rounded-lg border border-[#f2d38b] bg-[#fffaf0] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[12px] font-semibold uppercase tracking-wide text-[#8a6517]">Request pending</p>
                          <p className="mt-1 text-[14px] font-semibold text-[#111827]">{offer.pending_request.plan_name || 'Legacy request'}</p>
                          <p className="mt-1 text-[12px] text-[#667085]">Code: {offer.pending_request.public_code}</p>
                        </div>
                        {offer.pending_request.price_visible ? <div className="text-right text-[14px] font-semibold text-[#111827]">{money(offer.pending_request.final_price, offer.pending_request.currency)}</div> : null}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {offer.pending_request.can_change && !offer.pending_request.legacy && <button type="button" onClick={() => setChanging(true)} className="rounded border border-[#0076a8] px-3 py-2 text-[12px] font-semibold text-[#0076a8]">Change request</button>}
                        {offer.pending_request.can_cancel && <button type="button" onClick={cancelRequest} disabled={isPending} className="rounded border border-[#c53a35] px-3 py-2 text-[12px] font-semibold text-[#a12622] disabled:opacity-50">Cancel request</button>}
                        {supportUrl && <a href={supportUrl} target="_blank" rel="noreferrer" className="rounded border border-[#229ED9] px-3 py-2 text-[12px] font-semibold text-[#147fae]">Contact Support</a>}
                      </div>
                    </div>
                  ) : offer.mode === 'active' && !changing ? (
                    <div className="rounded-lg border border-[#ccebd6] bg-[#f4fcf7] p-4 text-[13px] text-[#245f37]">Your current access already covers this product. No upgrade is needed.</div>
                  ) : (
                    <>
                      {changing && <div className="flex items-center justify-between rounded-md bg-[#f7f9fb] px-3 py-2 text-[12px] text-[#475467]"><span>Changing request {offer.pending_request?.public_code}</span><button type="button" className="font-semibold text-[#0076a8]" onClick={() => setChanging(false)}>Keep current request</button></div>}

                      <div>
                        <label htmlFor={`royal-plan-${scopeType}-${targetKey}`} className="text-[12px] font-semibold text-[#344054]">Duration</label>
                        <select
                          id={`royal-plan-${scopeType}-${targetKey}`}
                          value={selectedPlanId || ''}
                          onChange={(event) => { setSelectedPlanId(Number(event.target.value)); setQuote(null); setError(''); }}
                          className="mt-1 w-full rounded-md border border-[#d0d5dd] bg-white px-3 py-2.5 text-[14px] text-[#111827]"
                        >
                          {offer.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {planLabel(plan.duration_months)}{plan.is_recommended ? ' · Recommended' : ''}</option>)}
                        </select>
                        {selectedPlan?.is_recommended && <span className="mt-2 inline-block rounded-full bg-[#eaf8fc] px-2 py-1 text-[10px] font-semibold text-[#0076a8]">Recommended</span>}
                      </div>

                      <div className="rounded-lg border border-[#e5e7eb] bg-[#fafafa] p-4">
                        {visibleQuote?.price_visible ? (
                          <>
                            <div className="flex items-center justify-between text-[13px]"><span className="text-[#667085]">Base price</span><span>{money(visibleQuote.base_price, visibleQuote.currency)}</span></div>
                            {quote?.promo_applied && <div className="mt-2 flex items-center justify-between text-[13px] text-[#087c31]"><span>Promo discount</span><span>-{money(quote.discount_amount, quote.currency)}</span></div>}
                            <div className="mt-3 flex items-center justify-between border-t border-[#e5e7eb] pt-3"><span className="text-[13px] font-semibold">Quoted price</span><span className="text-[19px] font-semibold text-[#111827]">{money(visibleQuote.final_price, visibleQuote.currency)}</span></div>
                          </>
                        ) : <p className="text-[14px] font-semibold text-[#111827]">Contact support for pricing</p>}
                      </div>

                      <div>
                        <label htmlFor={`promo-${scopeType}-${targetKey}`} className="text-[12px] font-semibold text-[#344054]">Promo code</label>
                        <div className="mt-1 flex gap-2">
                          <input id={`promo-${scopeType}-${targetKey}`} value={promoCode} onChange={(event) => { setPromoCode(event.target.value.toUpperCase()); setQuote(null); }} placeholder="Optional" className="min-w-0 flex-1 rounded-md border border-[#d0d5dd] px-3 py-2 text-[14px] uppercase" />
                          <button type="button" onClick={applyPromo} disabled={!selectedPlanId || isPending} className="rounded-md border border-[#0076a8] px-3 py-2 text-[12px] font-semibold text-[#0076a8] disabled:opacity-50">Apply</button>
                        </div>
                        {quote?.promo_applied && !quote.price_visible && <p className="mt-2 text-[11px] text-[#087c31]">Promo accepted. Support will apply it when confirming the manual sale.</p>}
                      </div>

                      <button type="button" onClick={submit} disabled={!selectedPlanId || isPending || !offer.can_request} className="w-full rounded-md bg-[#0a8e31] px-4 py-3 text-[14px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                        {isPending ? 'Submitting…' : changing ? 'Replace pending request' : offer.mode === 'extension' ? 'Request extension' : 'Request upgrade'}
                      </button>
                      <p className="text-center text-[11px] leading-4 text-[#667085]">No automatic payment or activation: Royal Support confirms both manually.</p>
                    </>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

'use client';

import React, { useMemo, useState, useTransition } from 'react';
import { CheckCircle2, Copy, ExternalLink, Loader2, TicketPercent } from 'lucide-react';
import { createUpgradeRequest } from '@/actions/business';
import type {
  UpgradeCatalogBank,
  UpgradeCatalogPathway,
  UpgradeRequestReceipt,
  UpgradeScopeType,
} from '@/types/business';

interface UpgradeRequestClientProps {
  pathways: UpgradeCatalogPathway[];
  banks: UpgradeCatalogBank[];
  defaultBankId?: number;
  defaultPathwayId?: number;
  restrictPathwayId?: number;
  telegramSupportUrl: string | null;
}

export function UpgradeRequestClient({
  pathways,
  banks,
  defaultBankId,
  defaultPathwayId,
  restrictPathwayId,
  telegramSupportUrl,
}: UpgradeRequestClientProps) {
  const availableBanks = useMemo(
    () => restrictPathwayId ? banks.filter((bank) => bank.pathway_id === restrictPathwayId) : banks,
    [banks, restrictPathwayId]
  );
  const availablePathways = useMemo(
    () => restrictPathwayId ? pathways.filter((pathway) => pathway.id === restrictPathwayId) : pathways,
    [pathways, restrictPathwayId]
  );

  const initialBank = availableBanks.some((bank) => bank.id === defaultBankId)
    ? defaultBankId
    : availableBanks[0]?.id;
  const initialPathway = availablePathways.some((pathway) => pathway.id === defaultPathwayId)
    ? defaultPathwayId
    : availablePathways[0]?.id;
  const initialScope: UpgradeScopeType = defaultBankId && initialBank
    ? 'bank'
    : defaultPathwayId && initialPathway
      ? 'pathway'
      : initialBank
        ? 'bank'
        : 'pathway';

  const [scopeType, setScopeType] = useState<UpgradeScopeType>(initialScope);
  const [bankId, setBankId] = useState<number | undefined>(initialBank);
  const [pathwayId, setPathwayId] = useState<number | undefined>(initialPathway);
  const [promoCode, setPromoCode] = useState('');
  const [receipt, setReceipt] = useState<UpgradeRequestReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  const contextPathway = restrictPathwayId
    ? pathways.find((pathway) => pathway.id === restrictPathwayId)
    : undefined;

  const selectedProduct = useMemo(() => {
    if (scopeType === 'global') return 'Royal Global Access';
    if (scopeType === 'pathway') {
      return pathways.find((pathway) => pathway.id === pathwayId)?.name || 'Pathway';
    }
    return banks.find((bank) => bank.id === bankId)?.name || 'Question Bank';
  }, [bankId, banks, pathwayId, pathways, scopeType]);

  const scopeOptions: Array<[UpgradeScopeType, string]> = restrictPathwayId
    ? [['pathway', 'Full Pathway'], ['bank', 'Single Bank']]
    : [['bank', 'Question Bank'], ['pathway', 'Full Pathway'], ['global', 'All Royal']];

  function submitRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCopied(false);

    startTransition(async () => {
      const result = await createUpgradeRequest({
        scopeType,
        pathwayId: scopeType === 'pathway' ? pathwayId ?? null : null,
        bankId: scopeType === 'bank' ? bankId ?? null : null,
        promoCode: promoCode.trim() || undefined,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setReceipt(result.data);
    });
  }

  async function copySupportMessage() {
    if (!receipt) return;
    const message = `Hello Royal Support, I want to complete my activation. Request: ${receipt.public_code}`;
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (receipt) {
    return (
      <section className="mx-auto max-w-xl rounded-xl border border-emerald-500/30 bg-[#32393f] p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-7 w-7 text-emerald-400" />
          <div>
            <h1 className="text-xl font-bold text-white">Upgrade request created</h1>
            <p className="mt-1 text-sm font-medium text-[#c4cdd4]">Contact Royal Support on Telegram to complete payment and activation.</p>
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-[#4b565f] bg-[#282e33] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#9ba8b1]">Request ID</p>
          <p className="mt-2 font-mono text-2xl font-bold tracking-wider text-white">{receipt.public_code}</p>
          <p className="mt-3 text-sm font-medium text-[#d1d8dd]">{receipt.product_name}</p>
          {receipt.promo_applied && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
              <TicketPercent className="h-3.5 w-3.5" /> Promo code attached to this request
            </p>
          )}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={copySupportMessage}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[#65717a] bg-[#3a434a] px-4 text-sm font-semibold text-white hover:bg-[#46515a]"
          >
            <Copy className="h-4 w-4" /> {copied ? 'Message copied' : 'Copy support message'}
          </button>

          {telegramSupportUrl ? (
            <a
              href={telegramSupportUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#2AABEE] px-4 text-sm font-semibold text-white hover:brightness-110"
            >
              Contact on Telegram <ExternalLink className="h-4 w-4" />
            </a>
          ) : (
            <div className="flex min-h-11 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 text-center text-xs font-medium text-amber-200">
              Telegram support link is being configured. Keep your Request ID.
            </div>
          )}
        </div>

        <p className="mt-5 text-xs font-medium leading-5 text-[#aeb9c1]">
          Support may ask you to confirm the email registered with Royal. Access is activated only after payment is confirmed.
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-2xl rounded-xl border border-[#4d5860] bg-[#32393f] p-6 text-white shadow-xl">
      <div className="mb-6">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#a7b3bb]">Royal Access</p>
        <h1 className="mt-2 text-2xl font-bold text-white">Upgrade your account</h1>
        <p className="mt-2 text-sm font-medium leading-6 text-[#c7d0d6]">
          Choose exactly what you want to activate, add a promo code if you have one, then contact support.
        </p>
      </div>

      {contextPathway && (
        <div className="mb-5 rounded-lg border border-blue-400/25 bg-blue-500/10 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-300">Pathway</p>
          <p className="mt-1 text-sm font-bold text-white">{contextPathway.name}</p>
          <p className="mt-1 text-xs font-medium text-[#b9c7d2]">Activate the whole pathway or choose one bank inside it.</p>
        </div>
      )}

      {error && (
        <div className="mb-5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-200">{error}</div>
      )}

      <form onSubmit={submitRequest} className="space-y-5">
        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-[#b5c0c8]">Access type</label>
          <div className={`grid gap-2 ${scopeOptions.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
            {scopeOptions.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setScopeType(value)}
                className={`rounded-lg border px-3 py-3 text-sm font-bold transition ${
                  scopeType === value
                    ? 'border-blue-400 bg-blue-500/25 text-white'
                    : 'border-[#59656e] bg-[#282e33] text-[#c3ccd2] hover:border-[#7b8993] hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {scopeType === 'bank' && (
          <div>
            <label htmlFor="upgrade-bank" className="mb-2 block text-xs font-bold uppercase tracking-wide text-[#b5c0c8]">Question bank</label>
            <select
              id="upgrade-bank"
              value={bankId ?? ''}
              onChange={(event) => setBankId(Number(event.target.value))}
              required
              className="h-11 w-full rounded-lg border border-[#59656e] bg-[#282e33] px-3 text-sm font-semibold text-white outline-none focus:border-blue-400"
            >
              {availableBanks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}
            </select>
          </div>
        )}

        {scopeType === 'pathway' && (
          <div>
            <label htmlFor="upgrade-pathway" className="mb-2 block text-xs font-bold uppercase tracking-wide text-[#b5c0c8]">Pathway</label>
            {availablePathways.length === 1 ? (
              <div className="flex h-11 items-center rounded-lg border border-[#59656e] bg-[#282e33] px-3 text-sm font-semibold text-white">
                {availablePathways[0].name}
              </div>
            ) : (
              <select
                id="upgrade-pathway"
                value={pathwayId ?? ''}
                onChange={(event) => setPathwayId(Number(event.target.value))}
                required
                className="h-11 w-full rounded-lg border border-[#59656e] bg-[#282e33] px-3 text-sm font-semibold text-white outline-none focus:border-blue-400"
              >
                {availablePathways.map((pathway) => <option key={pathway.id} value={pathway.id}>{pathway.name}</option>)}
              </select>
            )}
          </div>
        )}

        <div>
          <label htmlFor="promo-code" className="mb-2 block text-xs font-bold uppercase tracking-wide text-[#b5c0c8]">
            Promo code <span className="normal-case font-medium text-[#8e9ba4]">(optional)</span>
          </label>
          <input
            id="promo-code"
            value={promoCode}
            onChange={(event) => setPromoCode(event.target.value.toUpperCase())}
            maxLength={32}
            autoComplete="off"
            placeholder="Enter promo code"
            className="h-11 w-full rounded-lg border border-[#59656e] bg-[#282e33] px-3 text-sm font-semibold uppercase text-white outline-none placeholder:normal-case placeholder:font-medium placeholder:text-[#84929c] focus:border-blue-400"
          />
        </div>

        <div className="rounded-lg border border-[#46525b] bg-[#282e33] px-4 py-3 text-sm font-medium text-[#d0d7dc]">
          Requested access: <span className="font-bold text-white">{selectedProduct}</span>
        </div>

        <button
          type="submit"
          disabled={isPending || (scopeType === 'bank' && !bankId) || (scopeType === 'pathway' && !pathwayId)}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPending ? 'Creating request...' : 'Continue to Support'}
        </button>
      </form>
    </section>
  );
}

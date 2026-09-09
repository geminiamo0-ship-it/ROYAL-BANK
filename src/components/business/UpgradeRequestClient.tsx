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
  telegramSupportUrl: string | null;
}

export function UpgradeRequestClient({
  pathways,
  banks,
  defaultBankId,
  telegramSupportUrl,
}: UpgradeRequestClientProps) {
  const initialBank = banks.some((bank) => bank.id === defaultBankId)
    ? defaultBankId
    : banks[0]?.id;
  const [scopeType, setScopeType] = useState<UpgradeScopeType>(initialBank ? 'bank' : 'pathway');
  const [bankId, setBankId] = useState<number | undefined>(initialBank);
  const [pathwayId, setPathwayId] = useState<number | undefined>(pathways[0]?.id);
  const [promoCode, setPromoCode] = useState('');
  const [receipt, setReceipt] = useState<UpgradeRequestReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  const selectedProduct = useMemo(() => {
    if (scopeType === 'global') return 'Royal Global Access';
    if (scopeType === 'pathway') {
      return pathways.find((pathway) => pathway.id === pathwayId)?.name || 'Pathway';
    }
    return banks.find((bank) => bank.id === bankId)?.name || 'Question Bank';
  }, [bankId, banks, pathwayId, pathways, scopeType]);

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
            <h1 className="text-xl font-semibold text-white">Upgrade request created</h1>
            <p className="mt-1 text-sm text-[#b7c2ca]">Contact Royal Support on Telegram to complete payment and activation.</p>
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-[#4b565f] bg-[#282e33] p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-[#8897a2]">Request ID</p>
          <p className="mt-2 font-mono text-2xl font-bold tracking-wider text-white">{receipt.public_code}</p>
          <p className="mt-3 text-sm text-[#c8d0d6]">{receipt.product_name}</p>
          {receipt.promo_applied && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-300">
              <TicketPercent className="h-3.5 w-3.5" />
              Promo code attached to this request
            </p>
          )}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={copySupportMessage}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[#5b6872] bg-[#3a434a] px-4 text-sm font-semibold text-white hover:bg-[#46515a]"
          >
            <Copy className="h-4 w-4" />
            {copied ? 'Message copied' : 'Copy support message'}
          </button>

          {telegramSupportUrl ? (
            <a
              href={telegramSupportUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#2AABEE] px-4 text-sm font-semibold text-white hover:brightness-110"
            >
              Contact on Telegram
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : (
            <div className="flex min-h-11 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 text-center text-xs text-amber-200">
              Telegram support link is being configured. Keep your Request ID.
            </div>
          )}
        </div>

        <p className="mt-5 text-xs leading-5 text-[#99a7b1]">
          Support may ask you to confirm the email registered with Royal. Access is activated only after support confirms payment.
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-2xl rounded-xl border border-[#424b52] bg-[#32393f] p-6 shadow-xl">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#9caab4]">Royal Access</p>
        <h1 className="mt-2 text-2xl font-semibold text-white">Upgrade your account</h1>
        <p className="mt-2 text-sm leading-6 text-[#b7c2ca]">
          Choose the access you want, add a promo code if you have one, then contact support to complete activation.
        </p>
      </div>

      {error && (
        <div className="mb-5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <form onSubmit={submitRequest} className="space-y-5">
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[#9caab4]">Access type</label>
          <div className="grid gap-2 sm:grid-cols-3">
            {([
              ['bank', 'Question Bank'],
              ['pathway', 'Full Pathway'],
              ['global', 'All Royal'],
            ] as Array<[UpgradeScopeType, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setScopeType(value)}
                className={`rounded-lg border px-3 py-3 text-sm font-semibold transition ${
                  scopeType === value
                    ? 'border-blue-400 bg-blue-500/20 text-white'
                    : 'border-[#4b565f] bg-[#2b3136] text-[#b8c2ca] hover:border-[#687782]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {scopeType === 'bank' && (
          <div>
            <label htmlFor="upgrade-bank" className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[#9caab4]">Question bank</label>
            <select
              id="upgrade-bank"
              value={bankId ?? ''}
              onChange={(event) => setBankId(Number(event.target.value))}
              required
              className="h-11 w-full rounded-lg border border-[#4b565f] bg-[#282e33] px-3 text-sm text-white outline-none focus:border-blue-400"
            >
              {banks.map((bank) => (
                <option key={bank.id} value={bank.id}>{bank.name}</option>
              ))}
            </select>
          </div>
        )}

        {scopeType === 'pathway' && (
          <div>
            <label htmlFor="upgrade-pathway" className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[#9caab4]">Pathway</label>
            <select
              id="upgrade-pathway"
              value={pathwayId ?? ''}
              onChange={(event) => setPathwayId(Number(event.target.value))}
              required
              className="h-11 w-full rounded-lg border border-[#4b565f] bg-[#282e33] px-3 text-sm text-white outline-none focus:border-blue-400"
            >
              {pathways.map((pathway) => (
                <option key={pathway.id} value={pathway.id}>{pathway.name}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label htmlFor="promo-code" className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[#9caab4]">Promo code <span className="normal-case text-[#75828b]">(optional)</span></label>
          <input
            id="promo-code"
            value={promoCode}
            onChange={(event) => setPromoCode(event.target.value.toUpperCase())}
            maxLength={32}
            autoComplete="off"
            placeholder="Enter promo code"
            className="h-11 w-full rounded-lg border border-[#4b565f] bg-[#282e33] px-3 text-sm uppercase text-white outline-none placeholder:normal-case placeholder:text-[#6e7c86] focus:border-blue-400"
          />
        </div>

        <div className="rounded-lg bg-[#282e33] px-4 py-3 text-sm text-[#c9d1d7]">
          Requested access: <span className="font-semibold text-white">{selectedProduct}</span>
        </div>

        <button
          type="submit"
          disabled={isPending || (scopeType === 'bank' && !bankId) || (scopeType === 'pathway' && !pathwayId)}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPending ? 'Creating request...' : 'Continue to Support'}
        </button>
      </form>
    </section>
  );
}

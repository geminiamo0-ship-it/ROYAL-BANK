import React from 'react';
import { createClient } from '@/lib/supabase/server';
import { UpgradeRequestClient } from '@/components/business/UpgradeRequestClient';
import type { UpgradeCatalogBank, UpgradeCatalogPathway } from '@/types/business';

function getTelegramSupportUrl(): string | null {
  const directUrl = process.env.ROYAL_SUPPORT_TELEGRAM_URL?.trim();
  if (directUrl) {
    try {
      const url = new URL(directUrl);
      if (url.protocol === 'https:' && ['t.me', 'telegram.me'].includes(url.hostname)) {
        return url.toString();
      }
    } catch {
      // Fall through to the username form.
    }
  }

  const username = process.env.ROYAL_SUPPORT_TELEGRAM_USERNAME?.trim().replace(/^@/, '');
  if (username && /^[A-Za-z0-9_]{5,32}$/.test(username)) {
    return `https://t.me/${username}`;
  }

  return null;
}

export default async function UpgradePage({
  searchParams,
}: {
  searchParams: Promise<{ bank?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawBank = Array.isArray(params.bank) ? params.bank[0] : params.bank;
  const parsedBank = rawBank ? Number(rawBank) : undefined;
  const defaultBankId = Number.isInteger(parsedBank) && Number(parsedBank) > 0 ? Number(parsedBank) : undefined;

  const supabase = await createClient();
  const [pathwaysResult, banksResult] = await Promise.all([
    supabase
      .from('pathways')
      .select('id,name,slug')
      .order('display_order', { ascending: true })
      .order('id', { ascending: true }),
    supabase
      .from('question_banks')
      .select('id,pathway_id,name')
      .order('display_order', { ascending: true })
      .order('id', { ascending: true }),
  ]);

  const pathways = (pathwaysResult.data || []) as UpgradeCatalogPathway[];
  const banks = (banksResult.data || []) as UpgradeCatalogBank[];
  const catalogError = pathwaysResult.error || banksResult.error;

  return (
    <div className="mx-auto max-w-5xl py-5">
      {catalogError || pathways.length === 0 || banks.length === 0 ? (
        <div className="mx-auto max-w-xl rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-100">
          Upgrade options are temporarily unavailable. Please contact Royal Support.
        </div>
      ) : (
        <UpgradeRequestClient
          pathways={pathways}
          banks={banks}
          defaultBankId={defaultBankId}
          telegramSupportUrl={getTelegramSupportUrl()}
        />
      )}
    </div>
  );
}

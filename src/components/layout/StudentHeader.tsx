'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getCatalogUpgradeOffer } from '@/actions/catalog';
import { useUIStore } from '@/stores/uiStore';
import { logout } from '@/actions/auth';
import type { CatalogUpgradeOffer } from '@/types/catalog';
import { RoyalThemeToggle } from '@/components/theme/RoyalThemeToggle';
import {
  CheckCircle2,
  Crown,
  LogOut,
  Menu,
  TicketCheck,
  UserCircle,
  X,
} from 'lucide-react';

interface StudentHeaderProps {
  userEmail?: string;
  userName?: string;
}

type BankOfferState = {
  bankId: number;
  offer: CatalogUpgradeOffer;
};

function formatAccessDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function accessScopeLabel(scopeType: CatalogUpgradeOffer['access']['scope_type']) {
  if (scopeType === 'global') return 'Royal Global Access';
  if (scopeType === 'pathway') return 'Full Pathway Access';
  if (scopeType === 'bank') return 'Question Bank Access';
  return 'Premium Access';
}

export function StudentHeader({
  userEmail = 'doctor@royalbank.com',
  userName = 'Doctor',
}: StudentHeaderProps) {
  const { toggleSidebar } = useUIStore();
  const pathname = usePathname();
  const bankMatch = pathname.match(/^\/bank\/(\d+)/);
  const bankId = bankMatch ? Number(bankMatch[1]) : null;
  const upgradeHref = bankId ? `/upgrade?bank=${bankId}` : '/upgrade';

  const [offerState, setOfferState] = React.useState<BankOfferState | null>(null);
  const [accessDetailsBankId, setAccessDetailsBankId] = React.useState<number | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    if (!bankId) {
      return () => {
        cancelled = true;
      };
    }

    void getCatalogUpgradeOffer({ scopeType: 'bank', targetId: bankId }).then((result) => {
      if (cancelled || !result.ok) return;
      setOfferState({ bankId, offer: result.data });
    });

    return () => {
      cancelled = true;
    };
  }, [bankId]);

  const offer = offerState?.bankId === bankId ? offerState.offer : null;
  const access = offer?.access;
  const isActivated = Boolean(access?.has_access);
  const isPending = !isActivated && offer?.mode === 'pending';
  const isCommerceBlocked = !isActivated && !isPending && offer?.mode === 'active' && offer.can_request === false;
  const showAccessDetails = bankId !== null && accessDetailsBankId === bankId;

  return (
    <>
      <header className="sticky top-0 z-30 flex h-[58px] items-center justify-between border-b border-transparent bg-[#282828] px-6 text-white">
        <div className="flex items-center">
          <button
            onClick={toggleSidebar}
            className="rounded p-1.5 text-[#9aa3aa] hover:bg-[#343434] hover:text-white"
            title="Toggle Navigation Sidebar"
          >
            <Menu className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center justify-end gap-3">
          {isActivated ? (
            <button
              type="button"
              onClick={() => setAccessDetailsBankId(bankId)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-emerald-500 px-2.5 text-[11px] font-bold text-white hover:bg-emerald-400"
              title="View activation details"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Activated
            </button>
          ) : isCommerceBlocked ? (
            <span
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 text-[11px] font-bold text-amber-300"
              title="Another Royal subscription or subscription request is already active"
            >
              <Crown className="h-3.5 w-3.5" />
              Subscription active
            </span>
          ) : (
            <Link
              href={upgradeHref}
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-amber-400 px-2.5 text-[11px] font-bold text-[#2c2512] hover:bg-amber-300"
            >
              <Crown className="h-3.5 w-3.5" />
              {isPending ? 'Pending' : 'Upgrade'}
            </Link>
          )}

          <RoyalThemeToggle />

          <Link
            href="/partner"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#9aa3aa] hover:bg-[#343434] hover:text-white"
            title="My Royal Coupon"
            aria-label="My Royal Coupon"
          >
            <TicketCheck className="h-4 w-4" />
          </Link>
          <div className="hidden text-right leading-tight md:block">
            <p className="max-w-[95px] truncate text-[11px] font-semibold text-white">{userName}</p>
            <p className="max-w-[95px] truncate text-[10px] text-[#b7c0c8]">{userEmail}</p>
          </div>
          <UserCircle className="h-8 w-8 text-[#b7c0c8]" />
          <form action={logout}>
            <button type="submit" className="text-[#9aa3aa] hover:text-white" title="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </div>
      </header>

      {showAccessDetails && access?.has_access ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-end bg-black/45 p-4 pt-[70px] sm:p-6 sm:pt-[74px]"
          role="dialog"
          aria-modal="true"
          aria-label="Activation details"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setAccessDetailsBankId(null);
          }}
        >
          <section className="w-full max-w-[360px] rounded-lg border border-[#4b555e] bg-[#30373d] p-4 text-white shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="mb-1 flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="text-[12px] font-bold uppercase tracking-wide">Activated</span>
                </div>
                <h2 className="text-[16px] font-bold">{offer?.product.name || 'Royal Access'}</h2>
              </div>
              <button
                type="button"
                onClick={() => setAccessDetailsBankId(null)}
                className="rounded p-1 text-[#aeb7bf] hover:bg-[#414a52] hover:text-white"
                aria-label="Close activation details"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 text-[12px]">
              <div className="rounded border border-[#46515a] bg-[#282f34] px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wide text-[#93a0aa]">Access type</p>
                <p className="mt-1 font-semibold">{accessScopeLabel(access.scope_type)}</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded border border-[#46515a] bg-[#282f34] px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-[#93a0aa]">Activated</p>
                  <p className="mt-1 font-medium">{formatAccessDate(access.starts_at)}</p>
                </div>
                <div className="rounded border border-[#46515a] bg-[#282f34] px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-[#93a0aa]">Expires</p>
                  <p className="mt-1 font-medium">
                    {access.is_lifetime ? 'Lifetime' : formatAccessDate(access.expires_at)}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-[#46515a] pt-3 text-[#b9c2c9]">
                <span>Coverage</span>
                <span className="font-semibold text-white">
                  {access.coverage_kind === 'broader' ? 'Included by broader plan' : 'Direct activation'}
                </span>
              </div>

              {access.grant_id ? (
                <div className="flex items-center justify-between text-[#b9c2c9]">
                  <span>Activation ID</span>
                  <span className="font-mono text-[11px] text-white">#{access.grant_id}</span>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

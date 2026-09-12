import React from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Crown, Infinity } from 'lucide-react';
import { logout, getCurrentUser } from '@/actions/auth';
import { getCatalogPathways, getGlobalCatalogState } from '@/actions/pathways';
import UpgradeModalTrigger from '@/components/business/UpgradeModalTrigger';
import { getRoyalSupportTelegramUrl } from '@/lib/royal-support';

function accessText(expiresAt: string | null, expiresSoon: boolean) {
  if (!expiresAt) return 'Lifetime access';
  const date = new Date(expiresAt);
  const formatted = Number.isNaN(date.getTime())
    ? expiresAt
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return `${expiresSoon ? 'Expires soon · ' : 'Active until '}${formatted}`;
}

function commerceLockText(reason: 'subscription' | 'request' | null) {
  return reason === 'request' ? 'Subscription request pending' : 'Subscription active';
}

function RoyalMark() {
  return (
    <span className="inline-flex items-end gap-[3px]" aria-hidden="true">
      <span className="h-3 w-[4px] rounded-[1px] bg-[#ff3948]" />
      <span className="h-5 w-[4px] rounded-[1px] bg-[#f6d51f]" />
      <span className="h-7 w-[4px] rounded-[1px] bg-[#42d448]" />
    </span>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const [user, pathways, globalCatalog] = await Promise.all([
    getCurrentUser(),
    getCatalogPathways(),
    getGlobalCatalogState(),
  ]);
  const isStaff = user?.role === 'admin' || user?.role === 'support';
  const supportUrl = getRoyalSupportTelegramUrl();
  const autoOpenGlobal = String(Array.isArray(query.upgradeGlobal) ? query.upgradeGlobal[0] : query.upgradeGlobal) === '1';
  const globalAccess = globalCatalog.accessState;

  return (
    <main className="min-h-screen bg-[#20262b] text-white">
      <header className="sticky top-0 z-30 border-b border-[#343b41] bg-[#282828]">
        <div className="mx-auto flex h-[58px] max-w-[1160px] items-center justify-between px-4 sm:px-6">
          <Link href="/dashboard" className="inline-flex items-center gap-2 text-[17px] font-bold tracking-[-0.02em] text-white">
            <RoyalMark />
            <span>RoyalBank</span>
          </Link>
          <nav className="flex items-center gap-4 text-[12px] text-[#b7c0c8]">
            {isStaff && (
              <Link href={user?.role === 'admin' ? '/admin' : '/support'} className="font-medium text-[#53c7f5] hover:text-white">
                {user?.role === 'admin' ? 'Admin' : 'Support'}
              </Link>
            )}
            <span className="hidden max-w-[180px] truncate sm:inline">{user?.full_name || user?.email || 'Doctor'}</span>
            <form action={logout}>
              <button type="submit" className="text-[#9aa3aa] transition hover:text-white">Sign out</button>
            </form>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-[1160px] px-4 pb-14 pt-5 sm:px-6 sm:pt-6">
        <section className="relative overflow-hidden rounded-[5px] border border-[#414a52] bg-[#30373d] px-5 py-6 shadow-[0_10px_30px_rgba(0,0,0,0.18)] sm:px-7 sm:py-7">
          <div
            className="pointer-events-none absolute inset-y-0 right-0 hidden w-[42%] opacity-90 sm:block"
            style={{
              background: 'linear-gradient(135deg, transparent 0 18%, rgba(21,111,89,.48) 18% 58%, rgba(39,121,101,.22) 58% 100%)',
            }}
          />
          <div className="relative z-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#35bdf0]">Royal access</p>
              <h1 className="mt-2 text-[28px] font-bold tracking-[-0.03em] text-white sm:text-[34px]">Your live Royal resources</h1>
              <p className="mt-2 max-w-[760px] text-[13px] leading-5 text-[#c1cbd2]">
                Choose a pathway, one bank, or All Royal access. Payment and activation stay manual through Support.
              </p>
              {globalAccess.has_access && (
                <p className="mt-3 inline-flex items-center gap-2 text-[12px] font-semibold text-emerald-400">
                  <Infinity className="h-4 w-4" />
                  All Royal: {accessText(globalAccess.expires_at, globalAccess.expires_soon)}
                </p>
              )}
            </div>

            {globalCatalog.catalogAvailable && (
              <div className="relative z-10 shrink-0">
                {globalAccess.has_access ? (
                  globalAccess.coverage_kind === 'exact' && globalAccess.can_extend ? (
                    <UpgradeModalTrigger
                      scopeType="global"
                      label="Extend All Royal"
                      autoOpen={autoOpenGlobal}
                      supportUrl={supportUrl}
                      className="inline-flex items-center justify-center rounded-md bg-emerald-500 px-4 py-2.5 text-[12px] font-bold text-white transition hover:bg-emerald-400"
                    />
                  ) : (
                    <span className="inline-flex items-center gap-2 rounded-md border border-emerald-500/55 bg-emerald-500/10 px-4 py-2.5 text-[12px] font-bold text-emerald-300">
                      <CheckCircle2 className="h-4 w-4" />
                      All Royal activated
                    </span>
                  )
                ) : globalCatalog.commerceLocked ? (
                  <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-[12px] font-semibold text-amber-300">
                    {commerceLockText(globalCatalog.commerceLockReason)}
                  </span>
                ) : (
                  <UpgradeModalTrigger
                    scopeType="global"
                    label="Upgrade All Royal"
                    autoOpen={autoOpenGlobal}
                    supportUrl={supportUrl}
                    className="inline-flex items-center justify-center rounded-md bg-emerald-500 px-4 py-2.5 text-[12px] font-bold text-white shadow-[0_4px_16px_rgba(16,185,129,.18)] transition hover:bg-emerald-400"
                  />
                )}
              </div>
            )}
          </div>
        </section>

        <section className="pt-8">
          <div className="mb-5">
            <h2 className="text-[22px] font-bold tracking-[-0.02em] text-white">Your pathways</h2>
            <p className="mt-1 text-[13px] text-[#aeb9c1]">Pathways and Royal resources currently available to your account.</p>
          </div>

          {pathways.length === 0 ? (
            <div className="rounded-md border border-[#414a52] bg-[#30373d] p-8 text-center">
              <h3 className="text-[16px] font-semibold text-white">No pathways are available</h3>
              <p className="mt-2 text-[13px] text-[#aeb9c1]">The catalog will populate automatically when a pathway is added to the database.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {pathways.map((pathway) => {
                const detailsHref = `/pathway/${pathway.slug}`;
                const articleCount = pathway.banks.reduce((sum, bank) => sum + bank.textbookArticleCount, 0);
                const access = pathway.accessState;

                return (
                  <article
                    key={pathway.id}
                    className="overflow-hidden rounded-[5px] border border-[#414a52] bg-[#30373d] shadow-[0_10px_24px_rgba(0,0,0,0.18)]"
                  >
                    {pathway.iconUrl ? (
                      <div
                        className="relative h-24 border-b border-[#414a52] bg-[#244b47] bg-contain bg-center bg-no-repeat"
                        style={{ backgroundImage: `linear-gradient(135deg, rgba(11,76,69,.25), rgba(27,106,87,.45)), url('${pathway.iconUrl}')` }}
                      />
                    ) : (
                      <div
                        className="relative h-24 border-b border-[#414a52]"
                        style={{ background: 'linear-gradient(135deg, #164842 0%, #245e54 52%, #203a3d 52%, #30373d 100%)' }}
                      >
                        <div className="absolute bottom-4 left-5"><RoyalMark /></div>
                      </div>
                    )}

                    <div className="p-5">
                      <h3 className="text-[18px] font-bold leading-6 text-white">{pathway.name}</h3>
                      <p className="mt-2 min-h-[42px] text-[13px] leading-[19px] text-[#b8c2ca]">{pathway.description || 'Royal question-bank pathway.'}</p>

                      <dl className="mt-4 grid grid-cols-3 overflow-hidden rounded border border-[#46515a] bg-[#282f34] text-center">
                        <div className="border-r border-[#46515a] px-2 py-2.5">
                          <dt className="text-[10px] text-[#8f9da7]">Banks</dt>
                          <dd className="mt-0.5 text-[14px] font-bold text-white">{pathway.banks.length}</dd>
                        </div>
                        <div className="border-r border-[#46515a] px-2 py-2.5">
                          <dt className="text-[10px] text-[#8f9da7]">Questions</dt>
                          <dd className="mt-0.5 text-[14px] font-bold text-white">{pathway.totalQuestions.toLocaleString()}</dd>
                        </div>
                        <div className="px-2 py-2.5">
                          <dt className="text-[10px] text-[#8f9da7]">Articles</dt>
                          <dd className="mt-0.5 text-[14px] font-bold text-white">{articleCount.toLocaleString()}</dd>
                        </div>
                      </dl>

                      {access.has_access && (
                        <p className="mt-4 inline-flex items-center gap-2 text-[11px] font-semibold text-emerald-400">
                          <Infinity className="h-4 w-4" />
                          {accessText(access.expires_at, access.expires_soon)}
                        </p>
                      )}

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <Link
                          href={detailsHref}
                          className="inline-flex items-center gap-1.5 rounded-md bg-[#2f7df4] px-3 py-2 text-[12px] font-bold text-white transition hover:bg-[#4a8df3]"
                        >
                          Open Pathway
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>

                        {access.has_access ? (
                          access.coverage_kind === 'exact' && access.can_extend && pathway.catalogAvailable ? (
                            <UpgradeModalTrigger
                              scopeType="pathway"
                              targetId={pathway.id}
                              label="Extend Access"
                              supportUrl={supportUrl}
                              className="rounded-md border border-emerald-500/55 bg-emerald-500/10 px-3 py-2 text-[12px] font-bold text-emerald-300 transition hover:bg-emerald-500/15"
                            />
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/55 bg-emerald-500/10 px-3 py-2 text-[12px] font-bold text-emerald-300">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Activated
                            </span>
                          )
                        ) : pathway.catalogAvailable ? (
                          pathway.commerceLocked ? (
                            <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] font-semibold text-amber-300">
                              {commerceLockText(pathway.commerceLockReason)}
                            </span>
                          ) : (
                            <UpgradeModalTrigger
                              scopeType="pathway"
                              targetId={pathway.id}
                              label="Upgrade"
                              supportUrl={supportUrl}
                              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/55 bg-emerald-500/10 px-3 py-2 text-[12px] font-bold text-emerald-300 transition hover:bg-emerald-500/15"
                            />
                          )
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

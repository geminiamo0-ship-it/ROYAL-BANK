import React from 'react';
import Link from 'next/link';
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
    <main className="min-h-screen bg-[#f4f4f4] text-[#111827]">
      <header className="border-b border-[#d9d9d9] bg-white">
        <div className="mx-auto flex h-12 max-w-[930px] items-center justify-between px-4">
          <Link href="/dashboard" className="text-[15px] font-semibold text-[#111827]">Royal<span className="text-[#0076a8]">Bank</span></Link>
          <nav className="flex items-center gap-4 text-[12px] text-[#333333]">
            {isStaff && <Link href={user?.role === 'admin' ? '/admin' : '/support'} className="text-[#0076a8] hover:underline">{user?.role === 'admin' ? 'Admin' : 'Support'}</Link>}
            <span className="hidden max-w-[180px] truncate sm:inline">{user?.full_name || user?.email || 'Doctor'}</span>
            <form action={logout}><button type="submit" className="text-[#555555] hover:text-[#111827]">Sign out</button></form>
          </nav>
        </div>
      </header>

      <section className="border-b border-[#d9d9d9] bg-white">
        <div className="mx-auto flex max-w-[930px] flex-col gap-5 px-4 py-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[#111827]">Your live Royal resources</h1>
            <p className="mt-1 text-[13px] text-[#555555]">Choose a pathway, one bank, or All Royal access. Payment and activation stay manual through Support.</p>
            {globalAccess.has_access && <p className="mt-2 text-[12px] font-semibold text-[#087c31]">All Royal: {accessText(globalAccess.expires_at, globalAccess.expires_soon)}</p>}
          </div>
          {globalCatalog.catalogAvailable && (
            globalAccess.has_access ? (
              globalAccess.coverage_kind === 'exact' && globalAccess.can_extend
                ? <UpgradeModalTrigger scopeType="global" label="Extend All Royal" autoOpen={autoOpenGlobal} supportUrl={supportUrl} className="rounded bg-[#14833d] px-4 py-2 text-[12px] font-semibold text-white" />
                : <span className="rounded border border-[#159947] bg-[#effbf3] px-4 py-2 text-[12px] font-semibold text-[#087c31]">All Royal activated</span>
            ) : globalCatalog.commerceLocked ? (
              <span className="rounded border border-[#d7b96b] bg-[#fff8e8] px-4 py-2 text-[12px] font-semibold text-[#7a5b15]">{commerceLockText(globalCatalog.commerceLockReason)}</span>
            ) : (
              <UpgradeModalTrigger scopeType="global" label="Upgrade All Royal" autoOpen={autoOpenGlobal} supportUrl={supportUrl} className="rounded bg-[#18a84a] px-4 py-2 text-[12px] font-semibold text-white" />
            )
          )}
        </div>
      </section>

      <section className="mx-auto max-w-[930px] px-4 py-10">
        {pathways.length === 0 ? (
          <div className="rounded-lg border border-[#d7d7d7] bg-white p-8 text-center">
            <h2 className="text-[16px] font-semibold text-[#111827]">No pathways are available</h2>
            <p className="mt-2 text-[13px] text-[#666666]">The catalog will populate automatically when a pathway is added to the database.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {pathways.map((pathway) => {
              const detailsHref = `/pathway/${pathway.slug}`;
              const articleCount = pathway.banks.reduce((sum, bank) => sum + bank.textbookArticleCount, 0);
              const access = pathway.accessState;

              return (
                <article key={pathway.id} className="overflow-hidden rounded-[2px] border border-[#d7d7d7] bg-white shadow-[0_1px_5px_rgba(0,0,0,0.12)]">
                  {pathway.iconUrl ? <div className="h-20 border-b border-[#e5e5e5] bg-[#f7f7f7] bg-contain bg-center bg-no-repeat" style={{ backgroundImage: `url('${pathway.iconUrl}')` }} /> : <div className="h-20 border-b border-[#e5e5e5] bg-[#eef4f7]" />}
                  <div className="px-4 pb-4 pt-4">
                    <h2 className="text-[16px] font-semibold leading-5 text-black">{pathway.name}</h2>
                    <p className="mt-3 min-h-[58px] text-[13px] leading-[19px] text-[#333333]">{pathway.description || 'Royal question-bank pathway.'}</p>
                    <dl className="mt-3 grid grid-cols-3 border border-[#e5e5e5] bg-[#fafafa] text-center">
                      <div className="border-r border-[#e5e5e5] px-2 py-2"><dt className="text-[10px] text-[#666666]">Banks</dt><dd className="text-[13px] font-semibold text-black">{pathway.banks.length}</dd></div>
                      <div className="border-r border-[#e5e5e5] px-2 py-2"><dt className="text-[10px] text-[#666666]">Questions</dt><dd className="text-[13px] font-semibold text-black">{pathway.totalQuestions.toLocaleString()}</dd></div>
                      <div className="px-2 py-2"><dt className="text-[10px] text-[#666666]">Articles</dt><dd className="text-[13px] font-semibold text-black">{articleCount.toLocaleString()}</dd></div>
                    </dl>

                    {access.has_access && <p className="mt-3 text-[11px] font-medium text-[#087c31]">{accessText(access.expires_at, access.expires_soon)}</p>}

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Link href={detailsHref} className="border border-[#00a2d3] px-[8px] py-[4px] text-[12px] leading-none text-[#007fa8] hover:bg-[#eaf8fc]">Open Pathway</Link>
                      {access.has_access ? (
                        access.coverage_kind === 'exact' && access.can_extend && pathway.catalogAvailable
                          ? <UpgradeModalTrigger scopeType="pathway" targetId={pathway.id} label="Extend Access" supportUrl={supportUrl} />
                          : <span className="border border-[#159947] bg-[#effbf3] px-[8px] py-[4px] text-[12px] font-medium leading-none text-[#087c31]">Activated</span>
                      ) : pathway.catalogAvailable ? (
                        pathway.commerceLocked
                          ? <span className="border border-[#d7b96b] bg-[#fff8e8] px-[8px] py-[4px] text-[12px] font-medium leading-none text-[#7a5b15]">{commerceLockText(pathway.commerceLockReason)}</span>
                          : <UpgradeModalTrigger scopeType="pathway" targetId={pathway.id} supportUrl={supportUrl} />
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

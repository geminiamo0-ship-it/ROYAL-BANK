import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentUser, logout } from '@/actions/auth';
import { getPathwayDetails, type ActiveAccessGrant, type PathwayDetail } from '@/actions/pathways';
import UpgradeModalTrigger from '@/components/business/UpgradeModalTrigger';
import { getRoyalSupportTelegramUrl } from '@/lib/royal-support';

interface PathwayBanksPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function formatAccessDate(value: string | null) {
  if (!value) return 'Lifetime';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function accessLabel(grant: ActiveAccessGrant, pathway: PathwayDetail) {
  if (grant.scope_type === 'global') return 'All Royal access';
  if (grant.scope_type === 'pathway') return `${pathway.name} pathway`;
  return pathway.banks.find((candidate) => candidate.id === grant.question_bank_id)?.name || 'Question bank access';
}

function stateText(expiresAt: string | null, expiresSoon: boolean) {
  if (!expiresAt) return 'Lifetime access';
  return `${expiresSoon ? 'Expires soon · ' : 'Active until '}${formatAccessDate(expiresAt)}`;
}

function commerceLockText(reason: 'subscription' | 'request' | null) {
  return reason === 'request' ? 'Subscription request pending' : 'Subscription active';
}

export default async function PathwayBanksPage({ params, searchParams }: PathwayBanksPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const [pathway, user] = await Promise.all([getPathwayDetails(slug), getCurrentUser()]);
  if (!pathway) notFound();

  const isStaff = user?.role === 'admin' || user?.role === 'support';
  const firstAvailableBank = pathway.banks.find((bank) => bank.isUnlocked);
  const autoPathway = String(Array.isArray(query.upgradePathway) ? query.upgradePathway[0] : query.upgradePathway) === String(pathway.id);
  const autoBankId = Number(Array.isArray(query.upgradeBank) ? query.upgradeBank[0] : query.upgradeBank);
  const supportUrl = getRoyalSupportTelegramUrl();

  return (
    <main className="min-h-screen bg-[#f4f4f4] text-black">
      <header className="border-b border-[#d9d9d9] bg-white">
        <div className="mx-auto flex h-12 max-w-[930px] items-center justify-between px-4">
          <Link href="/dashboard" className="text-[15px] font-semibold text-[#111827]">Royal<span className="text-[#0076a8]">Bank</span></Link>
          <nav className="flex items-center gap-4 text-[12px] text-[#333333]">
            <Link href="/dashboard" className="text-[#0076a8] hover:underline">All resources</Link>
            {isStaff && <Link href={user?.role === 'admin' ? '/admin' : '/support'} className="text-[#0076a8] hover:underline">{user?.role === 'admin' ? 'Admin' : 'Support'}</Link>}
            <span className="hidden max-w-[180px] truncate sm:inline">{user?.full_name || user?.email || 'Doctor'}</span>
            <form action={logout}><button type="submit" className="text-[#555555] hover:text-[#111827]">Sign out</button></form>
          </nav>
        </div>
      </header>

      <section className="border-b border-[#d9d9d9] bg-white px-4 py-8">
        <div className="mx-auto max-w-[930px]">
          <p className="text-[12px] text-[#0076a8]">Live pathway</p>
          <h1 className="mt-1 text-[32px] font-semibold leading-tight text-[#111827]">{pathway.name}</h1>
          <p className="mt-2 max-w-[700px] text-[14px] leading-6 text-[#444444]">{pathway.description}</p>
          {pathway.accessState.has_access && <p className="mt-3 text-[12px] font-semibold text-[#087c31]">{stateText(pathway.accessState.expires_at, pathway.accessState.expires_soon)}</p>}
          <div className="mt-5 flex flex-wrap gap-2">
            {firstAvailableBank && <Link href={`/bank/${firstAvailableBank.id}`} className="bg-[#273445] px-4 py-2 text-[12px] font-semibold text-white">Open available bank</Link>}
            {pathway.accessState.has_access ? (
              pathway.accessState.coverage_kind === 'exact' && pathway.accessState.can_extend && pathway.catalogAvailable
                ? <UpgradeModalTrigger scopeType="pathway" targetId={pathway.id} label="Extend Access" autoOpen={autoPathway} supportUrl={supportUrl} className="bg-[#14833d] px-4 py-2 text-[12px] font-semibold text-white" />
                : <a href="#access-details" className="bg-[#14833d] px-4 py-2 text-[12px] font-semibold text-white">Activated</a>
            ) : pathway.catalogAvailable ? (
              pathway.commerceLocked
                ? <span className="border border-[#d7b96b] bg-[#fff8e8] px-4 py-2 text-[12px] font-semibold text-[#7a5b15]">{commerceLockText(pathway.commerceLockReason)}</span>
                : <UpgradeModalTrigger scopeType="pathway" targetId={pathway.id} label="Upgrade full pathway" autoOpen={autoPathway} supportUrl={supportUrl} className="bg-[#18a84a] px-4 py-2 text-[12px] font-semibold text-white" />
            ) : null}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[930px] px-4 py-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="text-[22px] font-semibold text-black">Question banks</h2><p className="mt-1 text-[13px] text-[#555555]">Only banks currently linked to this pathway in Royal are listed.</p></div>
          <div className="text-right text-[12px] text-[#555555]"><p>{pathway.banks.length} bank{pathway.banks.length === 1 ? '' : 's'}</p><p>{pathway.totalQuestions.toLocaleString()} questions</p></div>
        </div>

        {pathway.banks.length === 0 ? <div className="rounded-lg border border-[#d7d7d7] bg-white p-8 text-center text-[13px] text-[#555555]">No question banks are currently attached to this pathway.</div> : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {pathway.banks.map((bank) => {
              const access = bank.accessState;
              return (
                <article key={bank.id} className="rounded-[2px] border border-[#d7d7d7] bg-white p-4 shadow-[0_1px_5px_rgba(0,0,0,0.12)]">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-[16px] font-semibold leading-5 text-black">{bank.name}</h3>
                    {access.has_access && <span className="border border-[#159947] bg-[#effbf3] px-2 py-1 text-[10px] font-semibold text-[#087c31]">Activated</span>}
                  </div>
                  <p className="mt-3 min-h-[58px] text-[13px] leading-[19px] text-[#333333]">{bank.description || 'Royal question bank.'}</p>
                  <dl className="mt-4 grid grid-cols-2 border border-[#e5e5e5] bg-[#fafafa] text-center">
                    <div className="border-r border-[#e5e5e5] px-2 py-2"><dt className="text-[10px] text-[#666666]">Questions</dt><dd className="text-[13px] font-semibold">{bank.questionCount.toLocaleString()}</dd></div>
                    <div className="px-2 py-2"><dt className="text-[10px] text-[#666666]">Library articles</dt><dd className="text-[13px] font-semibold">{bank.textbookArticleCount.toLocaleString()}</dd></div>
                  </dl>
                  {bank.isFreeTrialAvailable && !access.has_access && <p className="mt-3 text-[11px] text-[#555555]">Trial: up to {bank.freeTrialBlockLimit} blocks, {bank.freeTrialQuestionLimit} questions and {bank.freeTrialArticleLimit} articles.</p>}
                  {access.has_access && <p className="mt-3 text-[11px] font-medium text-[#087c31]">{stateText(access.expires_at, access.expires_soon)}{access.coverage_kind === 'broader' ? ' · Included in broader access' : ''}</p>}
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {access.has_access ? (
                      <>
                        <Link href={`/bank/${bank.id}`} className="border border-[#00a2d3] px-2 py-1 text-[12px] text-[#007fa8]">Open bank</Link>
                        {access.coverage_kind === 'exact' && access.can_extend && bank.catalogAvailable
                          ? <UpgradeModalTrigger scopeType="bank" targetId={bank.id} label="Extend Access" autoOpen={autoBankId === bank.id} supportUrl={supportUrl} />
                          : <a href="#access-details" className="border border-[#159947] bg-[#effbf3] px-2 py-1 text-[12px] font-medium text-[#087c31]">Activated</a>}
                      </>
                    ) : (
                      <>
                        {bank.isUnlocked && <Link href={`/bank/${bank.id}`} className="border border-[#00a2d3] px-2 py-1 text-[12px] text-[#007fa8]">Take a demo</Link>}
                        {bank.catalogAvailable && (
                          pathway.commerceLocked
                            ? <span className="border border-[#d7b96b] bg-[#fff8e8] px-2 py-1 text-[12px] font-medium text-[#7a5b15]">{commerceLockText(pathway.commerceLockReason)}</span>
                            : <UpgradeModalTrigger scopeType="bank" targetId={bank.id} label="Upgrade bank" autoOpen={autoBankId === bank.id} supportUrl={supportUrl} />
                        )}
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {pathway.activeAccess.length > 0 && (
          <section id="access-details" className="mt-12 scroll-mt-6 rounded-xl border border-[#cfd8d2] bg-white p-5 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#14833d]">Royal access</p>
            <h2 className="mt-1 text-[20px] font-semibold text-[#111827]">Your active subscription details</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {pathway.activeAccess.map((grant) => (
                <div key={grant.id} className="rounded-lg border border-[#e0e5e1] bg-[#fafcfb] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#666666]">{grant.scope_type} access</p>
                  <p className="mt-1 text-[15px] font-semibold text-[#111827]">{accessLabel(grant, pathway)}</p>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]"><div><p className="text-[#777777]">Started</p><p className="font-medium">{formatAccessDate(grant.starts_at)}</p></div><div><p className="text-[#777777]">Expires</p><p className="font-medium">{formatAccessDate(grant.expires_at)}</p></div></div>
                </div>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

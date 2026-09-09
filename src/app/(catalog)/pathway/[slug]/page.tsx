import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentUser, logout } from '@/actions/auth';
import { getPathwayDetails, type ActiveAccessGrant, type PathwayDetail } from '@/actions/pathways';

interface PathwayBanksPageProps {
  params: Promise<{ slug: string }>;
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
  const bank = pathway.banks.find((candidate) => candidate.id === grant.question_bank_id);
  return bank?.name || 'Question bank access';
}

export default async function PathwayBanksPage({ params }: PathwayBanksPageProps) {
  const { slug } = await params;
  const [pathway, user] = await Promise.all([getPathwayDetails(slug), getCurrentUser()]);
  if (!pathway) notFound();

  const isStaff = user?.role === 'admin' || user?.role === 'support';
  const firstAvailableBank = pathway.banks.find((bank) => bank.isUnlocked);

  return (
    <main className="min-h-screen bg-[#f4f4f4] text-black">
      <header className="border-b border-[#d9d9d9] bg-white">
        <div className="mx-auto flex h-12 max-w-[930px] items-center justify-between px-4">
          <Link href="/dashboard" className="text-[15px] font-semibold text-[#111827]">Royal<span className="text-[#0076a8]">Bank</span></Link>
          <nav className="flex items-center gap-4 text-[12px] text-[#333333]">
            <Link href="/dashboard" className="text-[#0076a8] hover:underline">All resources</Link>
            {isStaff && <Link href={user?.role === 'admin' ? '/admin' : '/support'} className="text-[#0076a8] hover:underline">{user?.role === 'admin' ? 'Admin' : 'Support'}</Link>}
            <span className="hidden max-w-[180px] truncate sm:inline">{user?.full_name || user?.email || 'Account'}</span>
            <form action={logout}><button type="submit" className="text-[#555555] hover:text-[#111827]">Sign out</button></form>
          </nav>
        </div>
      </header>

      <section className="bg-[#243746] px-4 py-9 text-white">
        <div className="mx-auto max-w-[930px]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9dc9d9]">Live pathway</p>
          <h1 className="mt-1 text-[32px] font-semibold">{pathway.name}</h1>
          <p className="mt-2 max-w-[650px] text-[14px] leading-6 text-[#d7e1e7]">{pathway.description || 'No description has been configured for this pathway.'}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {firstAvailableBank && <Link href={`/bank/${firstAvailableBank.id}`} className="bg-[#12a0bd] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[#0d8fa9]">Open available bank</Link>}
            {pathway.banks.length > 0 && (
              <Link href={pathway.hasFullAccess ? '#access-details' : `/upgrade?pathway=${pathway.id}`} className={`px-4 py-2 text-[12px] font-semibold text-white ${pathway.hasFullAccess ? 'bg-[#14833d] hover:bg-[#106f34]' : 'bg-[#18a84a] hover:bg-[#128c3d]'}`}>
                {pathway.hasFullAccess ? 'Activated' : 'Upgrade full pathway'}
              </Link>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[930px] px-4 py-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[22px] font-semibold">Question banks</h2>
            <p className="mt-1 text-[13px] text-[#555555]">Only banks currently configured in the live database are shown.</p>
          </div>
          <div className="text-right text-[12px] text-[#555555]">
            <p>{pathway.banks.length} bank{pathway.banks.length === 1 ? '' : 's'}</p>
            <p>{pathway.totalQuestions.toLocaleString()} mapped questions</p>
          </div>
        </div>

        {pathway.banks.length === 0 ? (
          <div className="rounded-lg border border-[#d7d7d7] bg-white p-8 text-center shadow-sm">
            <h3 className="text-[16px] font-semibold">No question banks are configured for this pathway.</h3>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {pathway.banks.map((bank) => (
              <article key={bank.id} className="rounded-lg border border-[#d7d7d7] bg-white p-4 shadow-[0_1px_5px_rgba(0,0,0,0.1)]">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-[16px] font-semibold leading-5">{bank.name}</h3>
                  {bank.hasPremiumAccess && <span className="border border-[#159947] bg-[#effbf3] px-2 py-1 text-[11px] font-medium text-[#087c31]">Activated</span>}
                </div>
                <p className="mt-3 min-h-[58px] text-[13px] leading-[19px] text-[#333333]">{bank.description || 'No description has been configured for this bank.'}</p>
                <div className="mt-4 grid grid-cols-2 border border-[#e5e5e5] bg-[#fafafa] text-center">
                  <div className="border-r border-[#e5e5e5] px-2 py-2"><span className="block text-[14px] font-semibold">{bank.questionCount.toLocaleString()}</span><span className="text-[11px] text-[#555555]">questions</span></div>
                  <div className="px-2 py-2"><span className="block text-[14px] font-semibold">{bank.textbookArticleCount.toLocaleString()}</span><span className="text-[11px] text-[#555555]">articles</span></div>
                </div>
                {bank.isFreeTrialAvailable && !bank.hasPremiumAccess && (
                  <p className="mt-3 text-[11px] text-[#666666]">Free trial: up to {bank.freeTrialQuestionLimit} questions, {bank.freeTrialBlockLimit ?? 0} blocks, and {bank.freeTrialArticleLimit} articles.</p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  {bank.hasPremiumAccess ? (
                    <><Link href={`/bank/${bank.id}`} className="border border-[#00a2d3] px-3 py-2 text-[12px] text-[#007fa8] hover:bg-[#eaf8fc]">Open bank</Link><Link href="#access-details" className="border border-[#159947] bg-[#effbf3] px-3 py-2 text-[12px] font-medium text-[#087c31]">Activated</Link></>
                  ) : (
                    <>{bank.isFreeTrialAvailable && bank.isUnlocked && <Link href={`/bank/${bank.id}`} className="border border-[#00a2d3] px-3 py-2 text-[12px] text-[#007fa8] hover:bg-[#eaf8fc]">Take a demo</Link>}<Link href={`/upgrade?bank=${bank.id}`} className="border border-[#1eb34a] px-3 py-2 text-[12px] font-medium text-[#0a8e31] hover:bg-[#eefbf2]">Upgrade bank</Link></>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}

        {pathway.activeAccess.length > 0 && (
          <section id="access-details" className="mt-12 scroll-mt-6 rounded-xl border border-[#cfd8d2] bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#14833d]">Royal access</p><h2 className="mt-1 text-[20px] font-semibold text-[#111827]">Your active subscription details</h2></div>
              <span className="rounded-full bg-[#eaf8ef] px-3 py-1.5 text-[11px] font-semibold text-[#087c31]">Active</span>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {pathway.activeAccess.map((grant) => (
                <div key={grant.id} className="rounded-lg border border-[#e0e5e1] bg-[#fafcfb] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#666666]">{grant.scope_type} access</p>
                  <p className="mt-1 text-[15px] font-semibold text-[#111827]">{accessLabel(grant, pathway)}</p>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]"><div><p className="text-[#777777]">Started</p><p className="mt-0.5 font-medium text-[#222222]">{formatAccessDate(grant.starts_at)}</p></div><div><p className="text-[#777777]">Expires</p><p className="mt-0.5 font-medium text-[#222222]">{formatAccessDate(grant.expires_at)}</p></div></div>
                </div>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

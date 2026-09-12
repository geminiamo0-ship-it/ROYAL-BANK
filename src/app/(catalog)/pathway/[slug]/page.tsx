import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, BookOpen, CheckCircle2, FileText, Infinity, ShieldCheck } from 'lucide-react';
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

function RoyalMark() {
  return (
    <span className="inline-flex items-end gap-[3px]" aria-hidden="true">
      <span className="h-3 w-[4px] rounded-[1px] bg-[#ff3948]" />
      <span className="h-5 w-[4px] rounded-[1px] bg-[#f6d51f]" />
      <span className="h-7 w-[4px] rounded-[1px] bg-[#42d448]" />
    </span>
  );
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
    <main className="min-h-screen bg-[#20262b] text-white">
      <header className="sticky top-0 z-30 border-b border-[#343b41] bg-[#282828]">
        <div className="mx-auto flex h-[58px] max-w-[1160px] items-center justify-between px-4 sm:px-6">
          <Link href="/dashboard" className="inline-flex items-center gap-2 text-[17px] font-bold tracking-[-0.02em] text-white">
            <RoyalMark />
            <span>RoyalBank</span>
          </Link>
          <nav className="flex items-center gap-4 text-[12px] text-[#b7c0c8]">
            <Link href="/dashboard" className="font-medium text-[#53c7f5] hover:text-white">All resources</Link>
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
          <div className="relative z-10 max-w-[760px]">
            <p className="text-[11px] font-semibold text-[#35bdf0]">Live pathway</p>
            <h1 className="mt-2 text-[32px] font-bold leading-tight tracking-[-0.03em] text-white sm:text-[36px]">{pathway.name}</h1>
            <p className="mt-2 max-w-[700px] text-[14px] leading-6 text-[#c1cbd2]">{pathway.description}</p>

            {pathway.accessState.has_access && (
              <p className="mt-3 inline-flex items-center gap-2 text-[12px] font-semibold text-emerald-400">
                <Infinity className="h-4 w-4" />
                {stateText(pathway.accessState.expires_at, pathway.accessState.expires_soon)}
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              {firstAvailableBank && (
                <Link
                  href={`/bank/${firstAvailableBank.id}`}
                  className="inline-flex items-center gap-2 rounded-md bg-[#2f7df4] px-4 py-2.5 text-[12px] font-bold text-white transition hover:bg-[#4a8df3]"
                >
                  Open available bank
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}

              {pathway.accessState.has_access ? (
                pathway.accessState.coverage_kind === 'exact' && pathway.accessState.can_extend && pathway.catalogAvailable ? (
                  <UpgradeModalTrigger
                    scopeType="pathway"
                    targetId={pathway.id}
                    label="Extend Access"
                    autoOpen={autoPathway}
                    supportUrl={supportUrl}
                    className="rounded-md border border-emerald-500/55 bg-emerald-500/10 px-4 py-2.5 text-[12px] font-bold text-emerald-300 transition hover:bg-emerald-500/15"
                  />
                ) : (
                  <a
                    href="#access-details"
                    className="inline-flex items-center gap-2 rounded-md border border-emerald-500/55 bg-emerald-500/10 px-4 py-2.5 text-[12px] font-bold text-emerald-300"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Activated
                  </a>
                )
              ) : pathway.catalogAvailable ? (
                pathway.commerceLocked ? (
                  <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-[12px] font-semibold text-amber-300">
                    {commerceLockText(pathway.commerceLockReason)}
                  </span>
                ) : (
                  <UpgradeModalTrigger
                    scopeType="pathway"
                    targetId={pathway.id}
                    label="Upgrade full pathway"
                    autoOpen={autoPathway}
                    supportUrl={supportUrl}
                    className="rounded-md bg-emerald-500 px-4 py-2.5 text-[12px] font-bold text-white transition hover:bg-emerald-400"
                  />
                )
              ) : null}
            </div>
          </div>
        </section>

        <section className="mt-5 rounded-[5px] border border-[#414a52] bg-[#30373d] p-5 shadow-[0_10px_24px_rgba(0,0,0,0.14)] sm:p-6">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-[#414a52] pb-5">
            <div>
              <h2 className="text-[22px] font-bold tracking-[-0.02em] text-white">Question banks</h2>
              <p className="mt-1 text-[13px] text-[#aeb9c1]">Only banks currently linked to this pathway in Royal are listed.</p>
            </div>
            <div className="text-right text-[12px] leading-5 text-[#aeb9c1]">
              <p>{pathway.banks.length} bank{pathway.banks.length === 1 ? '' : 's'}</p>
              <p>{pathway.totalQuestions.toLocaleString()} questions</p>
            </div>
          </div>

          {pathway.banks.length === 0 ? (
            <div className="rounded-md border border-[#46515a] bg-[#282f34] p-8 text-center text-[13px] text-[#aeb9c1]">
              No question banks are currently attached to this pathway.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {pathway.banks.map((bank) => {
                const access = bank.accessState;
                return (
                  <article key={bank.id} className="rounded-[5px] border border-[#46515a] bg-[#282f34] p-5 shadow-[0_8px_20px_rgba(0,0,0,0.12)]">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-[17px] font-bold leading-5 text-white">{bank.name}</h3>
                      {access.has_access && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded border border-emerald-500/55 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-300">
                          <CheckCircle2 className="h-3 w-3" />
                          Activated
                        </span>
                      )}
                    </div>

                    <p className="mt-3 min-h-[48px] text-[13px] leading-[19px] text-[#b8c2ca]">{bank.description || 'Royal question bank.'}</p>

                    <dl className="mt-4 grid grid-cols-2 overflow-hidden rounded border border-[#46515a] bg-[#242b30] text-center">
                      <div className="border-r border-[#46515a] px-3 py-3">
                        <dt className="flex items-center justify-center gap-1.5 text-[10px] text-[#8f9da7]"><FileText className="h-3.5 w-3.5" />Questions</dt>
                        <dd className="mt-1 text-[15px] font-bold text-white">{bank.questionCount.toLocaleString()}</dd>
                      </div>
                      <div className="px-3 py-3">
                        <dt className="flex items-center justify-center gap-1.5 text-[10px] text-[#8f9da7]"><BookOpen className="h-3.5 w-3.5" />Library articles</dt>
                        <dd className="mt-1 text-[15px] font-bold text-white">{bank.textbookArticleCount.toLocaleString()}</dd>
                      </div>
                    </dl>

                    {bank.isFreeTrialAvailable && !access.has_access && (
                      <p className="mt-3 text-[11px] leading-4 text-[#aeb9c1]">
                        Trial: up to {bank.freeTrialBlockLimit} blocks, {bank.freeTrialQuestionLimit} questions and {bank.freeTrialArticleLimit} articles.
                      </p>
                    )}

                    {access.has_access && (
                      <p className="mt-4 inline-flex items-center gap-2 text-[11px] font-semibold text-emerald-400">
                        <Infinity className="h-4 w-4" />
                        {stateText(access.expires_at, access.expires_soon)}{access.coverage_kind === 'broader' ? ' · Included in broader access' : ''}
                      </p>
                    )}

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {access.has_access ? (
                        <>
                          <Link
                            href={`/bank/${bank.id}`}
                            className="inline-flex items-center gap-1.5 rounded-md bg-[#2f7df4] px-3 py-2 text-[12px] font-bold text-white transition hover:bg-[#4a8df3]"
                          >
                            Open bank
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                          {access.coverage_kind === 'exact' && access.can_extend && bank.catalogAvailable ? (
                            <UpgradeModalTrigger
                              scopeType="bank"
                              targetId={bank.id}
                              label="Extend Access"
                              autoOpen={autoBankId === bank.id}
                              supportUrl={supportUrl}
                              className="rounded-md border border-emerald-500/55 bg-emerald-500/10 px-3 py-2 text-[12px] font-bold text-emerald-300 transition hover:bg-emerald-500/15"
                            />
                          ) : (
                            <a
                              href="#access-details"
                              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/55 bg-emerald-500/10 px-3 py-2 text-[12px] font-bold text-emerald-300"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Activated
                            </a>
                          )}
                        </>
                      ) : (
                        <>
                          {bank.isUnlocked && (
                            <Link
                              href={`/bank/${bank.id}`}
                              className="rounded-md bg-[#2f7df4] px-3 py-2 text-[12px] font-bold text-white transition hover:bg-[#4a8df3]"
                            >
                              Take a demo
                            </Link>
                          )}
                          {bank.catalogAvailable && (
                            pathway.commerceLocked ? (
                              <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] font-semibold text-amber-300">
                                {commerceLockText(pathway.commerceLockReason)}
                              </span>
                            ) : (
                              <UpgradeModalTrigger
                                scopeType="bank"
                                targetId={bank.id}
                                label="Upgrade bank"
                                autoOpen={autoBankId === bank.id}
                                supportUrl={supportUrl}
                                className="rounded-md bg-emerald-500 px-3 py-2 text-[12px] font-bold text-white transition hover:bg-emerald-400"
                              />
                            )
                          )}
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {pathway.activeAccess.length > 0 && (
          <section id="access-details" className="mt-5 scroll-mt-20 rounded-[5px] border border-[#414a52] bg-[#30373d] p-5 shadow-[0_10px_24px_rgba(0,0,0,0.14)] sm:p-6">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400">Royal access</p>
            <h2 className="mt-1 text-[20px] font-bold tracking-[-0.02em] text-white">Your active subscription details</h2>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {pathway.activeAccess.map((grant) => (
                <div key={grant.id} className="rounded-md border border-[#46515a] bg-[#282f34] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#8f9da7]">{grant.scope_type} access</p>
                      <p className="mt-1 text-[15px] font-bold text-white">{accessLabel(grant, pathway)}</p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" />
                      Activated
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[#46515a] pt-4 text-[12px]">
                    <div>
                      <p className="text-[#84929c]">Started</p>
                      <p className="mt-1 font-semibold text-white">{formatAccessDate(grant.starts_at)}</p>
                    </div>
                    <div>
                      <p className="text-[#84929c]">Expires</p>
                      <p className="mt-1 font-semibold text-white">{formatAccessDate(grant.expires_at)}</p>
                    </div>
                  </div>
                </div>
              ))}

              <div className="flex min-h-[150px] items-center gap-4 rounded-md border border-[#46515a] bg-[#282f34] p-5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#4f6370] bg-[#24313a] text-[#8fd4ff]">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-[13px] font-bold text-white">Full access to your activated Royal content</p>
                  <p className="mt-1 text-[12px] leading-5 text-[#aeb9c1]">Your active grants control question-bank and library access automatically.</p>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

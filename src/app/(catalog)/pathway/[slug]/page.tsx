import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentUser, logout } from '@/actions/auth';
import { getPathwayDetails, type ActiveAccessGrant, type PathwayDetail } from '@/actions/pathways';

interface PathwayBanksPageProps {
  params: Promise<{ slug: string }>;
}

const bankImages: Record<number, string> = {
  1: 'https://images.unsplash.com/photo-1581595220892-b0739db3ba8c?auto=format&fit=crop&w=700&q=80',
  2: 'https://images.unsplash.com/photo-1583912267550-d6c2ac63543f?auto=format&fit=crop&w=700&q=80',
  3: 'https://images.unsplash.com/photo-1581093588401-fbb62a02f120?auto=format&fit=crop&w=700&q=80',
  4: 'https://images.unsplash.com/photo-1559757175-0eb30cd8c063?auto=format&fit=crop&w=700&q=80',
  5: 'https://images.unsplash.com/photo-1551076805-e1869033e561?auto=format&fit=crop&w=700&q=80',
  6: 'https://images.unsplash.com/photo-1579165466991-467135ad3110?auto=format&fit=crop&w=700&q=80',
};

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
  return bank?.name.replace(`${pathway.name} — `, '') || 'Question bank access';
}

export default async function PathwayBanksPage({ params }: PathwayBanksPageProps) {
  const { slug } = await params;
  const [pathway, user] = await Promise.all([
    getPathwayDetails(slug),
    getCurrentUser(),
  ]);

  if (!pathway) notFound();

  const isStaff = user?.role === 'admin' || user?.role === 'support';
  const firstAvailableBank = pathway.banks.find((bank) => bank.isUnlocked);

  return (
    <main className="min-h-screen bg-[#f4f4f4] text-black">
      <header className="border-b border-[#d9d9d9] bg-white">
        <div className="mx-auto flex h-12 max-w-[930px] items-center justify-between px-4">
          <Link href="/dashboard" className="text-[15px] font-semibold text-[#111827]">
            Royal<span className="text-[#0076a8]">Bank</span>
          </Link>

          <nav className="flex items-center gap-4 text-[12px] text-[#333333]">
            <Link href="/dashboard" className="text-[#0076a8] hover:underline">All resources</Link>
            {isStaff && (
              <Link href={user?.role === 'admin' ? '/admin' : '/support'} className="text-[#0076a8] hover:underline">
                {user?.role === 'admin' ? 'Admin' : 'Support'}
              </Link>
            )}
            <span className="hidden max-w-[180px] truncate sm:inline">{user?.full_name || user?.email || 'Doctor'}</span>
            <form action={logout}>
              <button type="submit" className="text-[#555555] hover:text-[#111827]">Sign out</button>
            </form>
          </nav>
        </div>
      </header>

      <section
        className="flex min-h-[290px] items-start justify-center bg-cover bg-center px-4 pt-8"
        style={{ backgroundImage: "url('https://images.unsplash.com/photo-1551190822-a9333d879b1f?auto=format&fit=crop&w=1800&q=80')" }}
      >
        <div className="w-[560px] max-w-full bg-white/92 px-7 py-5 text-center shadow-sm backdrop-blur-sm">
          <h1 className="text-[36px] font-light leading-tight text-[#111827]">{pathway.name}</h1>
          <p className="mt-2 text-[16px] leading-6 text-[#333333]">Open the pathway, choose the bank you need, or activate the full pathway.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link href="/dashboard" className="bg-[#12a0bd] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[#0d8fa9]">
              All pathways
            </Link>
            {firstAvailableBank && (
              <Link href={`/bank/${firstAvailableBank.id}`} className="bg-[#273445] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[#1d2836]">
                Open available bank
              </Link>
            )}
            <Link
              href={pathway.hasFullAccess ? '#access-details' : `/upgrade?pathway=${pathway.id}`}
              className={`px-4 py-2 text-[12px] font-semibold text-white ${pathway.hasFullAccess ? 'bg-[#14833d] hover:bg-[#106f34]' : 'bg-[#18a84a] hover:bg-[#128c3d]'}`}
            >
              {pathway.hasFullAccess ? 'Activated' : 'Upgrade full pathway'}
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[930px] px-4 py-10">
        <div className="mb-6">
          <div className="text-[12px] text-[#555555]">
            <Link href="/dashboard" className="text-[#0076a8] hover:underline">All pathways</Link>
            <span className="px-2">/</span>
            <span>{pathway.name}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[22px] font-semibold text-black">{pathway.name} question banks</h2>
              <p className="mt-1 max-w-[650px] text-[13px] leading-5 text-[#333333]">
                Choose a bank below. Trial access and paid access are shown separately so it is always clear what you own.
              </p>
            </div>
            {!pathway.hasFullAccess && (
              <Link href={`/upgrade?pathway=${pathway.id}`} className="border border-[#1eb34a] bg-white px-3 py-2 text-[12px] font-semibold text-[#087c31] hover:bg-[#eefbf2]">
                Upgrade full pathway
              </Link>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {pathway.banks.map((bank) => {
            const shortName = bank.name.replace(`${pathway.name} — `, '').replace(`${pathway.name} â€” `, '');

            return (
              <article key={bank.id} className="overflow-hidden rounded-[2px] border border-[#d7d7d7] bg-white shadow-[0_1px_5px_rgba(0,0,0,0.12)]">
                <div className="h-20 w-full bg-cover bg-center" style={{ backgroundImage: `url('${bankImages[bank.id] || bankImages[1]}')` }} />
                <div className="px-4 pb-4 pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-[16px] font-semibold leading-5 text-black">{shortName}</h3>
                    {bank.hasPremiumAccess ? (
                      <span className="border border-[#159947] bg-[#effbf3] px-[6px] py-[3px] text-[11px] font-medium leading-none text-[#087c31]">Activated</span>
                    ) : bank.badge ? (
                      <span className="border border-[#1eb34a] px-[6px] py-[3px] text-[11px] leading-none text-[#0a9e34]">{bank.badge}</span>
                    ) : null}
                  </div>

                  <p className="mt-3 min-h-[76px] text-[13px] leading-[19px] text-black">{bank.description}</p>

                  <div className="mt-3 grid grid-cols-3 border border-[#e5e5e5] bg-[#fafafa] text-center">
                    <div className="border-r border-[#e5e5e5] px-2 py-2"><span className="block text-[13px] font-semibold text-black">{bank.questionCount.toLocaleString()}</span><span className="text-[11px] text-[#555555]">questions</span></div>
                    <div className="border-r border-[#e5e5e5] px-2 py-2"><span className="block text-[13px] font-semibold text-black">{bank.mockExamCount}</span><span className="text-[11px] text-[#555555]">mocks</span></div>
                    <div className="px-2 py-2"><span className="block text-[13px] font-semibold text-black">{bank.textbookArticleCount}</span><span className="text-[11px] text-[#555555]">texts</span></div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {bank.hasPremiumAccess ? (
                      <>
                        <Link href={`/bank/${bank.id}`} className="border border-[#00a2d3] px-[8px] py-[4px] text-[12px] leading-none text-[#007fa8] hover:bg-[#eaf8fc]">Open bank</Link>
                        <Link href="#access-details" className="border border-[#159947] bg-[#effbf3] px-[8px] py-[4px] text-[12px] font-medium leading-none text-[#087c31] hover:bg-[#e5f8eb]">Activated</Link>
                      </>
                    ) : (
                      <>
                        {bank.isFreeTrialAvailable && bank.isUnlocked && (
                          <Link href={`/bank/${bank.id}`} className="border border-[#00a2d3] px-[8px] py-[4px] text-[12px] leading-none text-[#007fa8] hover:bg-[#eaf8fc]">Take a demo</Link>
                        )}
                        <Link href={`/upgrade?bank=${bank.id}`} className="border border-[#1eb34a] px-[8px] py-[4px] text-[12px] font-medium leading-none text-[#0a8e31] hover:bg-[#eefbf2]">Upgrade bank</Link>
                      </>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {pathway.activeAccess.length > 0 && (
          <section id="access-details" className="mt-12 scroll-mt-6 rounded-xl border border-[#cfd8d2] bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#14833d]">Royal access</p>
                <h2 className="mt-1 text-[20px] font-semibold text-[#111827]">Your active subscription details</h2>
                <p className="mt-1 text-[13px] text-[#555555]">These are your current premium access grants for this pathway.</p>
              </div>
              <span className="rounded-full bg-[#eaf8ef] px-3 py-1.5 text-[11px] font-semibold text-[#087c31]">Active</span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {pathway.activeAccess.map((grant) => (
                <div key={grant.id} className="rounded-lg border border-[#e0e5e1] bg-[#fafcfb] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#666666]">{grant.scope_type} access</p>
                  <p className="mt-1 text-[15px] font-semibold text-[#111827]">{accessLabel(grant, pathway)}</p>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
                    <div><p className="text-[#777777]">Started</p><p className="mt-0.5 font-medium text-[#222222]">{formatAccessDate(grant.starts_at)}</p></div>
                    <div><p className="text-[#777777]">Expires</p><p className="mt-0.5 font-medium text-[#222222]">{formatAccessDate(grant.expires_at)}</p></div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentUser, logout } from '@/actions/auth';
import { getPathwayDetails } from '@/actions/pathways';

interface PathwayBanksPageProps {
  params: Promise<{
    slug: string;
  }>;
}

const bankImages: Record<number, string> = {
  1: 'https://images.unsplash.com/photo-1581595220892-b0739db3ba8c?auto=format&fit=crop&w=700&q=80',
  2: 'https://images.unsplash.com/photo-1583912267550-d6c2ac63543f?auto=format&fit=crop&w=700&q=80',
  3: 'https://images.unsplash.com/photo-1581093588401-fbb62a02f120?auto=format&fit=crop&w=700&q=80',
  4: 'https://images.unsplash.com/photo-1559757175-0eb30cd8c063?auto=format&fit=crop&w=700&q=80',
  5: 'https://images.unsplash.com/photo-1551076805-e1869033e561?auto=format&fit=crop&w=700&q=80',
  6: 'https://images.unsplash.com/photo-1579165466991-467135ad3110?auto=format&fit=crop&w=700&q=80',
};

export default async function PathwayBanksPage({ params }: PathwayBanksPageProps) {
  const { slug } = await params;
  const [pathway, user] = await Promise.all([
    getPathwayDetails(slug),
    getCurrentUser(),
  ]);

  if (!pathway) {
    notFound();
  }

  const isStaff = user?.role === 'admin' || user?.role === 'support';

  return (
    <main className="min-h-screen bg-[#f4f4f4] text-black">
      <header className="border-b border-[#d9d9d9] bg-white">
        <div className="mx-auto flex h-12 max-w-[930px] items-center justify-between px-4">
          <Link href="/dashboard" className="text-[15px] font-semibold text-[#111827]">
            Royal<span className="text-[#0076a8]">Bank</span>
          </Link>

          <nav className="flex items-center gap-4 text-[12px] text-[#333333]">
            <Link href="/dashboard" className="text-[#0076a8] hover:underline">
              All resources
            </Link>
            {isStaff && (
              <Link
                href={user?.role === 'admin' ? '/admin' : '/support'}
                className="text-[#0076a8] hover:underline"
              >
                {user?.role === 'admin' ? 'Admin' : 'Support'}
              </Link>
            )}
            <span className="hidden max-w-[180px] truncate sm:inline">
              {user?.full_name || user?.email || 'Doctor'}
            </span>
            <form action={logout}>
              <button type="submit" className="text-[#555555] hover:text-[#111827]">
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>

      <section
        className="flex h-[290px] items-start justify-center bg-cover bg-center pt-8"
        style={{
          backgroundImage:
            "url('https://images.unsplash.com/photo-1551190822-a9333d879b1f?auto=format&fit=crop&w=1800&q=80')",
        }}
      >
        <div className="w-[512px] max-w-[calc(100%-32px)] bg-white/88 px-7 py-4 text-center shadow-sm">
          <h1 className="text-[36px] font-light leading-tight text-[#111827]">
            {pathway.name}
          </h1>
          <p className="mt-2 text-[17px] leading-6 text-[#222222]">
            Choose a question bank for this pathway
          </p>
          <div className="mt-5 flex justify-center">
            <Link
              href="/dashboard"
              className="bg-[#12a0bd] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[#0d8fa9]"
            >
              All pathways
            </Link>
            <Link
              href={pathway.banks[0]?.isUnlocked ? `/bank/${pathway.banks[0].id}` : '/dashboard?upgrade=true'}
              className="bg-[#18a84a] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[#128c3d]"
            >
              Start now
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[930px] px-4 py-10">
        <div className="mb-6">
          <div className="text-[12px] text-[#555555]">
            <Link href="/dashboard" className="text-[#0076a8] hover:underline">
              All pathways
            </Link>
            <span className="px-2">/</span>
            <span>{pathway.name}</span>
          </div>
          <h2 className="mt-3 text-[22px] font-semibold text-black">
            {pathway.name} question banks
          </h2>
          <p className="mt-1 max-w-[650px] text-[13px] leading-5 text-[#333333]">
            Each bank has its own question count, mock exam set, textbook coverage, and performance analytics.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {pathway.banks.map((bank) => {
            const href = bank.isUnlocked ? `/bank/${bank.id}` : '/dashboard?upgrade=true';

            return (
              <article
                key={bank.id}
                className="overflow-hidden rounded-[2px] border border-[#d7d7d7] bg-white shadow-[0_1px_5px_rgba(0,0,0,0.12)]"
              >
                <div
                  className="h-20 w-full bg-cover bg-center"
                  style={{ backgroundImage: `url('${bankImages[bank.id] || bankImages[1]}')` }}
                />

                <div className="px-4 pb-4 pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-[16px] font-semibold leading-5 text-black">
                      {bank.name.replace(`${pathway.name} — `, '').replace(`${pathway.name} â€” `, '')}
                    </h3>
                    {bank.badge && (
                      <span className="border border-[#1eb34a] px-[6px] py-[3px] text-[11px] leading-none text-[#0a9e34]">
                        {bank.badge}
                      </span>
                    )}
                  </div>

                  <p className="mt-3 min-h-[76px] text-[13px] leading-[19px] text-black">
                    {bank.description}
                  </p>

                  <div className="mt-3 grid grid-cols-3 border border-[#e5e5e5] bg-[#fafafa] text-center">
                    <div className="border-r border-[#e5e5e5] px-2 py-2">
                      <span className="block text-[13px] font-semibold text-black">
                        {bank.questionCount.toLocaleString()}
                      </span>
                      <span className="text-[11px] text-[#555555]">questions</span>
                    </div>
                    <div className="border-r border-[#e5e5e5] px-2 py-2">
                      <span className="block text-[13px] font-semibold text-black">
                        {bank.mockExamCount}
                      </span>
                      <span className="text-[11px] text-[#555555]">mocks</span>
                    </div>
                    <div className="px-2 py-2">
                      <span className="block text-[13px] font-semibold text-black">
                        {bank.textbookArticleCount}
                      </span>
                      <span className="text-[11px] text-[#555555]">texts</span>
                    </div>
                  </div>

                  <div className="mt-3 min-h-[54px] text-[12px] leading-[18px] text-[#333333]">
                    <p>Analytics: isolated bank scoring, peer percentages, and category progress.</p>
                    <p>Mode: standard practice, review queue, and timed sets.</p>
                  </div>

                  <div className="mt-3 flex items-center">
                    <Link
                      href={href}
                      className="border border-[#00a2d3] px-[8px] py-[4px] text-[12px] leading-none text-[#0089b5] hover:bg-[#eaf8fc]"
                    >
                      Take a demo
                    </Link>
                    <Link
                      href={href}
                      className="-ml-px border border-[#1eb34a] px-[8px] py-[4px] text-[12px] leading-none text-[#0a9e34] hover:bg-[#eefbf2]"
                    >
                      {bank.isUnlocked ? 'Open bank' : 'Upgrade'}
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}

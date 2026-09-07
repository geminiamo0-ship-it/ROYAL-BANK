import React from 'react';
import Link from 'next/link';
import { logout, getCurrentUser } from '@/actions/auth';
import { getPathwayDetails } from '@/actions/pathways';

interface CatalogCard {
  title: string;
  description: string;
  imageUrl: string;
  href: string;
  pathwaySlug?: string;
  locked: boolean;
}

const CATALOG_CARDS: Omit<CatalogCard, 'locked'>[] = [
  {
    title: 'MRCP Part 1',
    description: 'Over 5,100 Single Best Answer questions plus full mock exams and a high-yield MRCP textbook.',
    imageUrl: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=700&q=80',
    href: '/pathway/mrcp-part-1',
    pathwaySlug: 'mrcp-part-1',
  },
  {
    title: 'MRCOG Part 1',
    description: 'Core obstetrics and gynaecology sciences with anatomy, embryology, physiology, and pharmacology practice.',
    imageUrl: 'https://images.unsplash.com/photo-1559757148-5c350d0d3c56?auto=format&fit=crop&w=700&q=80',
    href: '/pathway/mrcog-part-1',
    pathwaySlug: 'mrcog-part-1',
  },
  {
    title: 'Medical student finals / UKMLA resource',
    description: 'SBA questions for finals and UKMLA-style clinical practice with high-yield explanations.',
    imageUrl: 'https://images.unsplash.com/photo-1530497610245-94d3c16cda28?auto=format&fit=crop&w=700&q=80',
    href: '/pathway/plab-ukmla',
    pathwaySlug: 'plab-ukmla',
  },
  {
    title: 'MRCS Part A',
    description: 'Applied surgical anatomy, physiology, pathology, and clinical principles for Part A revision.',
    imageUrl: 'https://images.unsplash.com/photo-1551076805-e1869033e561?auto=format&fit=crop&w=700&q=80',
    href: '/pathway/mrcs-part-a',
    pathwaySlug: 'mrcs-part-a',
  },
  {
    title: 'MRCP Part 2 Written',
    description: 'Clinical reasoning and data interpretation practice for advanced internal medicine preparation.',
    imageUrl: 'https://images.unsplash.com/photo-1581093458791-9f3c3900df7b?auto=format&fit=crop&w=700&q=80',
    href: '/pathway/mrcp-part-2',
  },
  {
    title: 'PLAB Part 1',
    description: 'High-yield clinical scenarios, emergency protocols, and UK practice guidance for PLAB preparation.',
    imageUrl: 'https://images.unsplash.com/photo-1582750433449-648ed127bb54?auto=format&fit=crop&w=700&q=80',
    href: '/pathway/plab-part-1',
  },
];

export default async function DashboardPage() {
  const [user, ...pathwayAccess] = await Promise.all([
    getCurrentUser(),
    getPathwayDetails('mrcp-part-1'),
    getPathwayDetails('mrcog-part-1'),
    getPathwayDetails('plab-ukmla'),
    getPathwayDetails('mrcs-part-a'),
  ]);

  const isStaff = user?.role === 'admin' || user?.role === 'support';
  const accessBySlug = new Map(
    pathwayAccess
      .filter((pathway): pathway is NonNullable<typeof pathway> => pathway !== null)
      .map((pathway) => [pathway.slug, pathway.isUnlocked])
  );

  const catalogCards: CatalogCard[] = CATALOG_CARDS.map((card) => ({
    ...card,
    // Unknown/WIP pathways fail closed until they exist in the canonical catalog/DB.
    locked: card.pathwaySlug ? accessBySlug.get(card.pathwaySlug) !== true : true,
  }));

  return (
    <main className="min-h-screen bg-[#f4f4f4] text-[#111827]">
      <header className="border-b border-[#d9d9d9] bg-white">
        <div className="mx-auto flex h-12 max-w-[930px] items-center justify-between px-4">
          <Link href="/dashboard" className="text-[15px] font-semibold text-[#111827]">
            Royal<span className="text-[#0076a8]">Bank</span>
          </Link>

          <nav className="flex items-center gap-4 text-[12px] text-[#333333]">
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
        className="h-[82px] bg-cover bg-center"
        style={{
          backgroundImage:
            "url('https://images.unsplash.com/photo-1551190822-a9333d879b1f?auto=format&fit=crop&w=1800&q=80')",
        }}
      />

      <section className="mx-auto max-w-[930px] px-4 py-10">
        <div className="grid grid-cols-1 gap-x-6 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
          {catalogCards.map((card) => (
            <article
              key={card.title}
              className="overflow-hidden rounded-[2px] border border-[#d7d7d7] bg-white shadow-[0_1px_5px_rgba(0,0,0,0.12)]"
            >
              <div
                className="h-20 w-full bg-cover bg-center"
                style={{ backgroundImage: `url('${card.imageUrl}')` }}
              />

              <div className="px-4 pb-4 pt-4">
                <h2 className="text-[16px] font-semibold leading-5 text-black">
                  {card.title}
                </h2>
                <p className="mt-3 min-h-[72px] text-[13px] leading-[19px] text-black">
                  {card.description}
                </p>

                <div className="mt-3 flex items-center">
                  <Link
                    href={card.locked ? '/dashboard?upgrade=true' : card.href}
                    className="border border-[#00a2d3] px-[8px] py-[4px] text-[12px] leading-none text-[#0089b5] hover:bg-[#eaf8fc]"
                  >
                    Take a demo
                  </Link>
                  <Link
                    href={card.locked ? '/dashboard?upgrade=true' : card.href}
                    className="-ml-px border border-[#1eb34a] px-[8px] py-[4px] text-[12px] leading-none text-[#0a9e34] hover:bg-[#eefbf2]"
                  >
                    {card.locked ? 'Upgrade' : 'Open'}
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

import React from 'react';
import Link from 'next/link';
import { logout, getCurrentUser } from '@/actions/auth';
import { getCatalogPathways } from '@/actions/pathways';

export default async function DashboardPage() {
  const [user, pathways] = await Promise.all([getCurrentUser(), getCatalogPathways()]);
  const isStaff = user?.role === 'admin' || user?.role === 'support';

  return (
    <main className="min-h-screen bg-[#f4f4f4] text-[#111827]">
      <header className="border-b border-[#d9d9d9] bg-white">
        <div className="mx-auto flex h-12 max-w-[930px] items-center justify-between px-4">
          <Link href="/dashboard" className="text-[15px] font-semibold text-[#111827]">
            Royal<span className="text-[#0076a8]">Bank</span>
          </Link>
          <nav className="flex items-center gap-4 text-[12px] text-[#333333]">
            {isStaff && (
              <Link href={user?.role === 'admin' ? '/admin' : '/support'} className="text-[#0076a8] hover:underline">
                {user?.role === 'admin' ? 'Admin' : 'Support'}
              </Link>
            )}
            <span className="hidden max-w-[180px] truncate sm:inline">
              {user?.full_name || user?.email || 'Account'}
            </span>
            <form action={logout}>
              <button type="submit" className="text-[#555555] hover:text-[#111827]">Sign out</button>
            </form>
          </nav>
        </div>
      </header>

      <section className="border-b border-[#d9d9d9] bg-[#243746]">
        <div className="mx-auto max-w-[930px] px-4 py-8 text-white">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9dc9d9]">Live catalog</p>
          <h1 className="mt-1 text-[28px] font-semibold">Your Royal pathways</h1>
          <p className="mt-2 max-w-[620px] text-[13px] leading-5 text-[#d7e1e7]">
            Every resource shown below exists in the live database. No demo catalog entries or placeholder products are displayed.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-[930px] px-4 py-10">
        {pathways.length === 0 ? (
          <div className="rounded-lg border border-[#d7d7d7] bg-white p-8 text-center shadow-sm">
            <h2 className="text-[16px] font-semibold">No active pathways are configured.</h2>
            <p className="mt-2 text-[13px] text-[#555555]">Add a pathway and question bank in the database before testing the catalog.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {pathways.map((pathway) => {
              const actionHref = pathway.hasFullAccess
                ? `/pathway/${pathway.slug}#access-details`
                : `/upgrade?pathway=${pathway.id}`;

              return (
                <article key={pathway.id} className="overflow-hidden rounded-lg border border-[#d7d7d7] bg-white shadow-[0_1px_5px_rgba(0,0,0,0.1)]">
                  <div className="border-b border-[#e2e2e2] bg-[#eef3f5] px-4 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[#57707e]">Pathway</p>
                    <h2 className="mt-1 text-[17px] font-semibold text-black">{pathway.name}</h2>
                  </div>
                  <div className="px-4 pb-4 pt-4">
                    <p className="min-h-[58px] text-[13px] leading-[19px] text-[#303030]">
                      {pathway.description || 'No description has been configured for this pathway.'}
                    </p>
                    <div className="mt-4 grid grid-cols-2 gap-2 border-y border-[#ededed] py-3 text-center">
                      <div>
                        <p className="text-[15px] font-semibold text-black">{pathway.banks.length}</p>
                        <p className="text-[11px] text-[#666666]">banks</p>
                      </div>
                      <div>
                        <p className="text-[15px] font-semibold text-black">{pathway.totalQuestions.toLocaleString()}</p>
                        <p className="text-[11px] text-[#666666]">questions</p>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center gap-2">
                      <Link href={`/pathway/${pathway.slug}`} className="border border-[#00a2d3] px-3 py-2 text-[12px] text-[#007fa8] hover:bg-[#eaf8fc]">
                        Open Pathway
                      </Link>
                      <Link
                        href={actionHref}
                        className={`border px-3 py-2 text-[12px] font-medium ${
                          pathway.hasFullAccess
                            ? 'border-[#159947] bg-[#effbf3] text-[#087c31] hover:bg-[#e5f8eb]'
                            : 'border-[#1eb34a] text-[#0a8e31] hover:bg-[#eefbf2]'
                        }`}
                      >
                        {pathway.hasFullAccess ? 'Activated' : 'Upgrade'}
                      </Link>
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

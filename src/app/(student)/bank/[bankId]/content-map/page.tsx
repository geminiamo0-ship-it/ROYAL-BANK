import React from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Map, Activity } from 'lucide-react';
import {
  getLiveQuestionBankOutline,
  QuestionBankAccessError,
  QuestionBankAuthenticationError,
} from '@/lib/question-bank';

export default async function ContentMapPage({ params }: { params: Promise<{ bankId: string }> }) {
  const { bankId } = await params;
  const parsedBankId = Number(bankId);
  if (!Number.isInteger(parsedBankId) || parsedBankId <= 0) notFound();

  let categories;
  try {
    categories = await getLiveQuestionBankOutline(parsedBankId);
  } catch (error) {
    if (error instanceof QuestionBankAuthenticationError) redirect(`/login?redirect=/bank/${parsedBankId}/content-map`);
    if (error instanceof QuestionBankAccessError) redirect(`/upgrade?bank=${parsedBankId}`);
    throw error;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-16 text-xs sm:text-sm">
      <div className="rounded-xl border border-slate-700 bg-[#353c42] p-5 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-950/60 text-emerald-300"><Map className="h-5 w-5" /></div>
          <div><h1 className="text-lg font-bold text-white">Content Map</h1><p className="text-xs text-slate-300">Live categories and topics mapped to this question bank.</p></div>
        </div>
      </div>

      {categories.length === 0 ? (
        <div className="rounded-xl border border-slate-700 bg-[#353c42] p-8 text-center text-slate-400">No mapped categories are available.</div>
      ) : (
        <div className="space-y-4">
          {categories.map((category) => (
            <article key={category.id} className="rounded-xl border border-slate-700 bg-[#353c42] p-5 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 pb-3">
                <div className="flex items-center gap-2.5"><Activity className="h-4 w-4 text-emerald-400" /><span className="font-bold text-white">{category.name}</span></div>
                <span className="rounded-full bg-slate-700 px-2.5 py-1 text-[11px] font-semibold text-slate-200">{category.total.toLocaleString()} questions · {category.attempted.toLocaleString()} attempted</span>
              </div>
              {category.topics.length > 0 ? (
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {category.topics.map((topic) => (
                    <Link key={topic.id} href={`/bank/${parsedBankId}/question-bank`} className="rounded-lg border border-slate-700 bg-[#30363b] p-3 hover:border-blue-500/60">
                      <p className="font-semibold text-slate-100">{topic.name}</p>
                      <p className="mt-1 text-[11px] text-slate-400">{topic.total.toLocaleString()} questions · {topic.attempted.toLocaleString()} attempted · {topic.incorrectCount.toLocaleString()} incorrect</p>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-[11px] text-slate-400">No topic-level mapping is available inside this category.</p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

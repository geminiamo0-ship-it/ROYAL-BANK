import React from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { BarChart2, ChevronRight } from 'lucide-react';
import {
  getLiveQuestionBankOutline,
  QuestionBankAccessError,
  QuestionBankAuthenticationError,
} from '@/lib/question-bank';

export default async function PerformancePage({ params }: { params: Promise<{ bankId: string }> }) {
  const { bankId } = await params;
  const parsedBankId = Number(bankId);
  if (!Number.isInteger(parsedBankId) || parsedBankId <= 0) notFound();

  let categories;
  try {
    categories = await getLiveQuestionBankOutline(parsedBankId);
  } catch (error) {
    if (error instanceof QuestionBankAuthenticationError) redirect(`/login?redirect=/bank/${parsedBankId}/performance`);
    if (error instanceof QuestionBankAccessError) redirect(`/upgrade?bank=${parsedBankId}`);
    throw error;
  }

  const totalQuestions = categories.reduce((sum, item) => sum + item.total, 0);
  const totalAttempted = categories.reduce((sum, item) => sum + item.attempted, 0);
  const totalIncorrect = categories.reduce((sum, item) => sum + item.incorrectCount, 0);
  const totalCorrect = Math.max(0, totalAttempted - totalIncorrect);
  const totalFlagged = categories.reduce((sum, item) => sum + item.flaggedCount, 0);
  const overallAccuracy = totalAttempted > 0 ? Math.round((totalCorrect / totalAttempted) * 100) : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-16 text-xs sm:text-sm">
      <div className="flex flex-col gap-4 rounded-xl border border-slate-700 bg-[#353c42] p-5 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-950/60 text-blue-300"><BarChart2 className="h-5 w-5" /></div>
          <div><h1 className="text-lg font-bold text-white">Performance</h1><p className="text-xs text-slate-300">Live results calculated from your question-bank activity.</p></div>
        </div>
        <Link href={`/bank/${parsedBankId}/question-bank`} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700"><span>Open Question Bank</span><ChevronRight className="h-4 w-4" /></Link>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="Overall accuracy" value={`${overallAccuracy}%`} />
        <Metric label="Attempted" value={`${totalAttempted.toLocaleString()} / ${totalQuestions.toLocaleString()}`} />
        <Metric label="Correct" value={totalCorrect.toLocaleString()} />
        <Metric label="Flagged" value={totalFlagged.toLocaleString()} />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-700 bg-[#353c42] shadow-xs">
        <div className="border-b border-slate-700 px-4 py-3"><h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">Category performance</h2></div>
        {categories.length === 0 ? (
          <div className="p-8 text-center text-slate-400">No mapped categories are available for this bank.</div>
        ) : (
          <div className="divide-y divide-slate-700">
            {categories.map((item) => {
              const correct = Math.max(0, item.attempted - item.incorrectCount);
              const accuracy = item.attempted > 0 ? Math.round((correct / item.attempted) * 100) : 0;
              const completion = item.total > 0 ? Math.min(100, Math.round((item.attempted / item.total) * 100)) : 0;
              return (
                <div key={item.id} className="p-4">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div className="sm:w-1/3"><p className="font-bold text-white">{item.name}</p><p className="mt-1 text-[11px] text-slate-400">{item.attempted.toLocaleString()} attempted of {item.total.toLocaleString()} · {item.incorrectCount.toLocaleString()} incorrect · {item.flaggedCount.toLocaleString()} flagged</p></div>
                    <div className="sm:w-1/2">
                      <div className="mb-1.5 flex justify-between text-[11px]"><span className="font-semibold text-slate-200">Accuracy {accuracy}%</span><span className="text-slate-400">Completion {completion}%</span></div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-700"><div className="h-full rounded-full bg-slate-300" style={{ width: `${completion}%` }} /></div>
                    </div>
                    <div className="text-right text-[11px] text-slate-300">{correct.toLocaleString()} correct</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-700 bg-[#353c42] p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p><p className="mt-2 text-xl font-extrabold text-white">{value}</p></div>;
}

import React from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { RotateCcw, Flag, XCircle, Layers } from 'lucide-react';
import {
  getLiveQuestionBankOutline,
  QuestionBankAccessError,
  QuestionBankAuthenticationError,
} from '@/lib/question-bank';

export default async function ReviewQuestionsPage({ params }: { params: Promise<{ bankId: string }> }) {
  const { bankId } = await params;
  const parsedBankId = Number(bankId);
  if (!Number.isInteger(parsedBankId) || parsedBankId <= 0) notFound();

  let categories;
  try {
    categories = await getLiveQuestionBankOutline(parsedBankId);
  } catch (error) {
    if (error instanceof QuestionBankAuthenticationError) redirect(`/login?redirect=/bank/${parsedBankId}/review`);
    if (error instanceof QuestionBankAccessError) redirect(`/upgrade?bank=${parsedBankId}`);
    throw error;
  }

  const incorrect = categories.reduce((sum, category) => sum + category.incorrectCount, 0);
  const flagged = categories.reduce((sum, category) => sum + category.flaggedCount, 0);
  const attempted = categories.reduce((sum, category) => sum + category.attempted, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-16 text-xs sm:text-sm">
      <div className="flex flex-col gap-4 rounded-xl border border-slate-700 bg-[#353c42] p-5 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-950/60 text-red-300"><RotateCcw className="h-5 w-5" /></div>
          <div><h1 className="text-lg font-bold text-white">Question Review</h1><p className="text-xs text-slate-300">Live review counts from your actual answers and flags.</p></div>
        </div>
        <Link href={`/bank/${parsedBankId}/question-bank`} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700">Open selection controls</Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ReviewCard icon={<XCircle className="h-5 w-5 text-red-400" />} title="Previously Incorrect" value={incorrect} description="Use Incorrect in the live Question Bank selection." />
        <ReviewCard icon={<Flag className="h-5 w-5 text-amber-400" />} title="Flagged for Review" value={flagged} description="Use Flagged in the live Question Bank selection." />
        <ReviewCard icon={<Layers className="h-5 w-5 text-blue-400" />} title="All Attempted" value={attempted} description="Use All and your mapped filters to revisit answered questions." />
      </div>
    </div>
  );
}

function ReviewCard({ icon, title, value, description }: { icon: React.ReactNode; title: string; value: number; description: string }) {
  return <div className="rounded-xl border border-slate-700 bg-[#353c42] p-5"><div className="flex items-center justify-between">{icon}<span className="text-xl font-extrabold text-white">{value.toLocaleString()}</span></div><h2 className="mt-3 font-bold text-white">{title}</h2><p className="mt-1 text-xs text-slate-400">{description}</p></div>;
}

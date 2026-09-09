import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  getLiveQuestionBankOutline,
  QuestionBankAccessError,
  QuestionBankAuthenticationError,
} from '@/lib/question-bank';

export default async function ReviewQuestionsPage({ params }: { params: Promise<{ bankId: string }> }) {
  const { bankId } = await params;
  const parsedBankId = Number(bankId);
  if (!Number.isInteger(parsedBankId) || parsedBankId <= 0) notFound();

  let outline;
  try {
    outline = await getLiveQuestionBankOutline(parsedBankId);
  } catch (error) {
    if (error instanceof QuestionBankAuthenticationError) {
      redirect(`/login?redirect=/bank/${parsedBankId}/review`);
    }
    if (error instanceof QuestionBankAccessError) {
      redirect(`/upgrade?bank=${parsedBankId}`);
    }
    throw error;
  }

  const answered = outline.reduce((sum, category) => sum + category.attempted, 0);
  const incorrect = outline.reduce((sum, category) => sum + category.incorrectCount, 0);
  const flagged = outline.reduce((sum, category) => sum + category.flaggedCount, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-16">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-600">Live review data</p>
        <h1 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">Question Review</h1>
        <p className="mt-1 text-xs text-slate-500">Counts come from the production question-state dashboard. No review queue or totals are fabricated.</p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Metric label="Incorrect" value={incorrect} tone="red" />
        <Metric label="Flagged" value={flagged} tone="amber" />
        <Metric label="Answered" value={answered} tone="blue" />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="font-bold text-slate-900 dark:text-white">Review practice</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
          The counts above are real. A separate persisted review-session workflow is not exposed here until it has a production-backed launch path.
        </p>
        <Link href={`/bank/${parsedBankId}/question-bank`} className="mt-5 inline-flex rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700">Open question bank</Link>
      </section>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: 'red' | 'amber' | 'blue' }) {
  const toneClass = tone === 'red'
    ? 'border-red-200 text-red-600 dark:border-red-900'
    : tone === 'amber'
      ? 'border-amber-200 text-amber-600 dark:border-amber-900'
      : 'border-blue-200 text-blue-600 dark:border-blue-900';

  return (
    <div className={`rounded-xl border bg-white p-5 dark:bg-slate-900 ${toneClass}`}>
      <p className="text-[11px] font-bold uppercase tracking-wide">{label}</p>
      <p className="mt-2 text-3xl font-extrabold text-slate-900 dark:text-white">{value.toLocaleString()}</p>
    </div>
  );
}

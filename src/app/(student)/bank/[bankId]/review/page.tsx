import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

interface SessionCountRow {
  completed_count: number | null;
  correct_count: number | null;
}

export default async function ReviewQuestionsPage({ params }: { params: Promise<{ bankId: string }> }) {
  const { bankId } = await params;
  const parsedBankId = Number(bankId);
  if (!Number.isInteger(parsedBankId) || parsedBankId <= 0) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=/bank/${parsedBankId}/review`);

  const { data, error } = await supabase
    .from('exam_sessions')
    .select('completed_count,correct_count')
    .eq('user_id', user.id)
    .eq('question_bank_id', parsedBankId);

  if (error) throw new Error(error.message);
  const sessions = (data || []) as SessionCountRow[];
  const answered = sessions.reduce((sum, session) => sum + (session.completed_count ?? 0), 0);
  const correct = sessions.reduce((sum, session) => sum + (session.correct_count ?? 0), 0);
  const incorrect = Math.max(answered - correct, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-16">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-600">Live review data</p>
        <h1 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">Question Review</h1>
        <p className="mt-1 text-xs text-slate-500">Counts below come from your recorded sessions. No review queue is fabricated.</p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-red-200 bg-white p-5 dark:border-red-900 dark:bg-slate-900">
          <p className="text-[11px] font-bold uppercase tracking-wide text-red-600">Incorrect answers</p>
          <p className="mt-2 text-3xl font-extrabold text-slate-900 dark:text-white">{incorrect.toLocaleString()}</p>
          <p className="mt-2 text-xs text-slate-500">Total incorrect answers recorded across this bank&apos;s sessions.</p>
        </div>
        <div className="rounded-xl border border-blue-200 bg-white p-5 dark:border-blue-900 dark:bg-slate-900">
          <p className="text-[11px] font-bold uppercase tracking-wide text-blue-600">Answered</p>
          <p className="mt-2 text-3xl font-extrabold text-slate-900 dark:text-white">{answered.toLocaleString()}</p>
          <p className="mt-2 text-xs text-slate-500">Total answered question attempts recorded in sessions.</p>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="font-bold text-slate-900 dark:text-white">Review sessions</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">A dedicated persisted review queue is not available in the production schema yet. Until it exists, Royal will not generate fake review-session links or flagged counts.</p>
        <Link href={`/bank/${parsedBankId}/question-bank`} className="mt-5 inline-flex rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700">Open question bank</Link>
      </section>
    </div>
  );
}

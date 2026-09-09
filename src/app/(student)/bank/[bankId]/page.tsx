import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getBankDetails } from '@/actions/pathways';
import { createClient } from '@/lib/supabase/server';

interface ExamSessionRow {
  id: string;
  total_questions: number | null;
  completed_count: number | null;
  correct_count: number | null;
  percentage: number | null;
  is_completed: boolean | null;
  started_at: string;
  completed_at: string | null;
  mode: string | null;
}

function formatDate(value: string | null) {
  if (!value) return 'In progress';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function QuestionBankHomePage({ params }: { params: Promise<{ bankId: string }> }) {
  const { bankId } = await params;
  const parsedBankId = Number(bankId);
  if (!Number.isInteger(parsedBankId) || parsedBankId <= 0) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=/bank/${parsedBankId}`);

  const [bank, sessionsResult, categoriesResult] = await Promise.all([
    getBankDetails(parsedBankId),
    supabase
      .from('exam_sessions')
      .select('id,total_questions,completed_count,correct_count,percentage,is_completed,started_at,completed_at,mode')
      .eq('user_id', user.id)
      .eq('question_bank_id', parsedBankId)
      .order('started_at', { ascending: false })
      .limit(8),
    supabase
      .from('question_bank_categories')
      .select('category_id', { count: 'exact', head: true })
      .eq('question_bank_id', parsedBankId),
  ]);

  if (!bank) notFound();
  if (sessionsResult.error) throw new Error(sessionsResult.error.message);

  const sessions = (sessionsResult.data || []) as ExamSessionRow[];
  const completed = sessions.filter((session) => session.is_completed === true && session.percentage !== null);
  const average = completed.length > 0 ? completed.reduce((sum, session) => sum + Number(session.percentage || 0), 0) / completed.length : null;
  const answered = sessions.reduce((sum, session) => sum + (session.completed_count ?? 0), 0);
  const correct = sessions.reduce((sum, session) => sum + (session.correct_count ?? 0), 0);
  const accuracy = answered > 0 ? (correct / answered) * 100 : null;
  const categoryCount = categoriesResult.error ? null : categoriesResult.count ?? 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-12">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-600">Live question bank</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{bank.name}</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">{bank.description}</p>
          </div>
          <Link href={`/bank/${parsedBankId}/question-bank`} className="rounded-lg bg-blue-600 px-4 py-2 text-center text-xs font-bold text-white hover:bg-blue-700">Open question bank</Link>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="Questions" value={bank.questionCount.toLocaleString()} />
        <Metric label="Library articles" value={bank.textbookArticleCount.toLocaleString()} />
        <Metric label="Categories" value={categoryCount === null ? '—' : categoryCount.toLocaleString()} />
        <Metric label="Answered in sessions" value={answered.toLocaleString()} />
        <Metric label="Accuracy" value={accuracy === null ? '—' : `${accuracy.toFixed(1)}%`} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div><h2 className="font-bold text-slate-900 dark:text-white">Recent sessions</h2><p className="mt-1 text-xs text-slate-500">Real sessions recorded for your account in this bank.</p></div>
          <span className="text-xs font-semibold text-slate-500">Completed avg: {average === null ? '—' : `${average.toFixed(1)}%`}</span>
        </div>
        {sessions.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No sessions yet. Start from the question bank to create your first real session.</div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {sessions.map((session) => (
              <div key={session.id} className="grid grid-cols-2 gap-3 px-5 py-4 text-xs sm:grid-cols-5">
                <div><p className="text-slate-500">Started</p><p className="mt-1 font-semibold text-slate-900 dark:text-white">{formatDate(session.started_at)}</p></div>
                <div><p className="text-slate-500">Mode</p><p className="mt-1 font-semibold text-slate-900 dark:text-white">{session.mode || 'Standard'}</p></div>
                <div><p className="text-slate-500">Progress</p><p className="mt-1 font-semibold text-slate-900 dark:text-white">{session.completed_count ?? 0} / {session.total_questions ?? 0}</p></div>
                <div><p className="text-slate-500">Score</p><p className="mt-1 font-semibold text-slate-900 dark:text-white">{session.percentage === null ? '—' : `${Number(session.percentage).toFixed(1)}%`}</p></div>
                <div><p className="text-slate-500">Status</p><p className="mt-1 font-semibold text-slate-900 dark:text-white">{session.is_completed ? `Completed ${formatDate(session.completed_at)}` : 'In progress'}</p></div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{value}</p></div>;
}

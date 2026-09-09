import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
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
  elapsed_seconds: number | null;
  mode: string | null;
}

function formatDuration(seconds: number | null) {
  if (!seconds || seconds < 1) return '—';
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

export default async function PerformancePage({ params }: { params: Promise<{ bankId: string }> }) {
  const { bankId } = await params;
  const parsedBankId = Number(bankId);
  if (!Number.isInteger(parsedBankId) || parsedBankId <= 0) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=/bank/${parsedBankId}/performance`);

  const { data, error } = await supabase
    .from('exam_sessions')
    .select('id,total_questions,completed_count,correct_count,percentage,is_completed,started_at,completed_at,elapsed_seconds,mode')
    .eq('user_id', user.id)
    .eq('question_bank_id', parsedBankId)
    .order('started_at', { ascending: false });

  if (error) throw new Error(error.message);
  const sessions = (data || []) as ExamSessionRow[];
  const completedSessions = sessions.filter((session) => session.is_completed === true);
  const answered = sessions.reduce((sum, session) => sum + (session.completed_count ?? 0), 0);
  const correct = sessions.reduce((sum, session) => sum + (session.correct_count ?? 0), 0);
  const accuracy = answered > 0 ? (correct / answered) * 100 : null;
  const scored = completedSessions.filter((session) => session.percentage !== null);
  const averageScore = scored.length > 0 ? scored.reduce((sum, session) => sum + Number(session.percentage), 0) / scored.length : null;
  const bestScore = scored.length > 0 ? Math.max(...scored.map((session) => Number(session.percentage))) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-16">
      <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-600">Live analytics</p>
          <h1 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">Performance</h1>
          <p className="mt-1 text-xs text-slate-500">Calculated only from your recorded exam sessions in this bank.</p>
        </div>
        <Link href={`/bank/${parsedBankId}/question-bank`} className="rounded-lg bg-blue-600 px-4 py-2 text-center text-xs font-bold text-white hover:bg-blue-700">Practice questions</Link>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Questions answered" value={answered.toLocaleString()} />
        <Metric label="Overall accuracy" value={accuracy === null ? '—' : `${accuracy.toFixed(1)}%`} />
        <Metric label="Completed sessions" value={completedSessions.length.toLocaleString()} />
        <Metric label="Average completed score" value={averageScore === null ? '—' : `${averageScore.toFixed(1)}%`} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div><h2 className="font-bold text-slate-900 dark:text-white">Session history</h2><p className="mt-1 text-xs text-slate-500">No peer averages, percentiles or pass probabilities are fabricated here.</p></div>
          <span className="text-xs font-semibold text-slate-500">Best: {bestScore === null ? '—' : `${bestScore.toFixed(1)}%`}</span>
        </div>
        {sessions.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">No performance data yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/50"><tr><th className="px-5 py-3 font-semibold">Started</th><th className="px-5 py-3 font-semibold">Mode</th><th className="px-5 py-3 font-semibold">Answered</th><th className="px-5 py-3 font-semibold">Correct</th><th className="px-5 py-3 font-semibold">Score</th><th className="px-5 py-3 font-semibold">Time</th><th className="px-5 py-3 font-semibold">Status</th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {sessions.map((session) => (
                  <tr key={session.id}>
                    <td className="px-5 py-3 text-slate-700 dark:text-slate-200">{new Date(session.started_at).toLocaleDateString()}</td>
                    <td className="px-5 py-3 text-slate-700 dark:text-slate-200">{session.mode || 'Standard'}</td>
                    <td className="px-5 py-3 text-slate-700 dark:text-slate-200">{session.completed_count ?? 0} / {session.total_questions ?? 0}</td>
                    <td className="px-5 py-3 text-slate-700 dark:text-slate-200">{session.correct_count ?? 0}</td>
                    <td className="px-5 py-3 font-semibold text-slate-900 dark:text-white">{session.percentage === null ? '—' : `${Number(session.percentage).toFixed(1)}%`}</td>
                    <td className="px-5 py-3 text-slate-700 dark:text-slate-200">{formatDuration(session.elapsed_seconds)}</td>
                    <td className="px-5 py-3 text-slate-700 dark:text-slate-200">{session.is_completed ? 'Completed' : 'In progress'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900"><p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 text-2xl font-extrabold text-slate-900 dark:text-white">{value}</p></div>;
}

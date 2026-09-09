import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import {
  getLiveQuestionBankOutline,
  QuestionBankAccessError,
  QuestionBankAuthenticationError,
} from '@/lib/question-bank';

interface TestSessionRow {
  id: string;
  total_questions: number;
  session_type: string;
  is_completed: boolean;
  score_percentage: number | null;
  started_at: string;
  completed_at: string | null;
}

export default async function PerformancePage({ params }: { params: Promise<{ bankId: string }> }) {
  const { bankId } = await params;
  const parsedBankId = Number(bankId);
  if (!Number.isInteger(parsedBankId) || parsedBankId <= 0) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=/bank/${parsedBankId}/performance`);

  let outline;
  try {
    outline = await getLiveQuestionBankOutline(parsedBankId);
  } catch (error) {
    if (error instanceof QuestionBankAuthenticationError) {
      redirect(`/login?redirect=/bank/${parsedBankId}/performance`);
    }
    if (error instanceof QuestionBankAccessError) {
      redirect(`/upgrade?bank=${parsedBankId}`);
    }
    throw error;
  }

  const { data, error } = await supabase
    .from('test_sessions')
    .select('id,total_questions,session_type,is_completed,score_percentage,started_at,completed_at')
    .eq('user_id', user.id)
    .eq('question_bank_id', parsedBankId)
    .order('started_at', { ascending: false })
    .limit(50);

  const sessions = error ? [] : ((data || []) as TestSessionRow[]);
  const historyUnavailable = Boolean(error);

  const answered = outline.reduce((sum, category) => sum + category.attempted, 0);
  const incorrect = outline.reduce((sum, category) => sum + category.incorrectCount, 0);
  const flagged = outline.reduce((sum, category) => sum + category.flaggedCount, 0);
  const correct = Math.max(answered - incorrect, 0);
  const accuracy = answered > 0 ? (correct / answered) * 100 : null;

  const completedSessions = sessions.filter((session) => session.is_completed);
  const scored = completedSessions.filter((session) => session.score_percentage !== null);
  const averageScore = scored.length > 0
    ? scored.reduce((sum, session) => sum + Number(session.score_percentage), 0) / scored.length
    : null;
  const bestScore = scored.length > 0
    ? Math.max(...scored.map((session) => Number(session.score_percentage)))
    : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-16">
      <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-600">Live analytics</p>
          <h1 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">Performance</h1>
          <p className="mt-1 text-xs text-slate-500">Question-state metrics come from Royal&apos;s production dashboard cache; session history uses your real test sessions.</p>
        </div>
        <Link href={`/bank/${parsedBankId}/question-bank`} className="rounded-lg bg-blue-600 px-4 py-2 text-center text-xs font-bold text-white hover:bg-blue-700">Practice questions</Link>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Questions answered" value={answered.toLocaleString()} />
        <Metric label="Overall accuracy" value={accuracy === null ? '—' : `${accuracy.toFixed(1)}%`} />
        <Metric label="Incorrect" value={incorrect.toLocaleString()} />
        <Metric label="Flagged" value={flagged.toLocaleString()} />
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Metric label="Recent completed sessions" value={historyUnavailable ? '—' : completedSessions.length.toLocaleString()} />
        <Metric label="Recent completed average" value={averageScore === null ? '—' : `${averageScore.toFixed(1)}%`} />
        <Metric label="Recent best score" value={bestScore === null ? '—' : `${bestScore.toFixed(1)}%`} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <h2 className="font-bold text-slate-900 dark:text-white">Recent session history</h2>
          <p className="mt-1 text-xs text-slate-500">Latest 50 real sessions only; no fabricated peer averages, percentiles or pass probabilities.</p>
        </div>

        {historyUnavailable ? (
          <div className="p-10 text-center text-sm text-amber-600 dark:text-amber-300">Session history is temporarily unavailable.</div>
        ) : sessions.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">No performance sessions yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[650px] text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/50">
                <tr>
                  <th className="px-5 py-3 font-semibold">Started</th>
                  <th className="px-5 py-3 font-semibold">Type</th>
                  <th className="px-5 py-3 font-semibold">Questions</th>
                  <th className="px-5 py-3 font-semibold">Score</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {sessions.map((session) => (
                  <tr key={session.id}>
                    <td className="px-5 py-3 text-slate-700 dark:text-slate-200">{new Date(session.started_at).toLocaleDateString()}</td>
                    <td className="px-5 py-3 text-slate-700 dark:text-slate-200">{session.session_type || 'Standard'}</td>
                    <td className="px-5 py-3 text-slate-700 dark:text-slate-200">{session.total_questions}</td>
                    <td className="px-5 py-3 font-semibold text-slate-900 dark:text-white">{session.score_percentage === null ? '—' : `${Number(session.score_percentage).toFixed(1)}%`}</td>
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
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import {
  getLiveQuestionBankOutline,
  QuestionBankAccessError,
  QuestionBankAuthenticationError,
} from '@/lib/question-bank';

interface BankRow {
  id: number;
  name: string;
  description: string | null;
}

interface TestSessionRow {
  id: string;
  total_questions: number;
  session_type: string;
  is_completed: boolean;
  score_percentage: number | null;
  started_at: string;
  completed_at: string | null;
}

function formatDate(value: string | null) {
  if (!value) return 'In progress';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function QuestionBankHomePage({
  params,
}: {
  params: Promise<{ bankId: string }>;
}) {
  const { bankId } = await params;
  const parsedBankId = Number(bankId);
  if (!Number.isInteger(parsedBankId) || parsedBankId <= 0) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=/bank/${parsedBankId}`);

  let outline;
  try {
    outline = await getLiveQuestionBankOutline(parsedBankId);
  } catch (error) {
    if (error instanceof QuestionBankAuthenticationError) {
      redirect(`/login?redirect=/bank/${parsedBankId}`);
    }
    if (error instanceof QuestionBankAccessError) {
      redirect(`/upgrade?bank=${parsedBankId}`);
    }
    throw error;
  }

  const [bankResult, sessionsResult] = await Promise.all([
    supabase
      .from('question_banks')
      .select('id,name,description')
      .eq('id', parsedBankId)
      .maybeSingle(),
    supabase
      .from('test_sessions')
      .select('id,total_questions,session_type,is_completed,score_percentage,started_at,completed_at')
      .eq('user_id', user.id)
      .eq('question_bank_id', parsedBankId)
      .order('started_at', { ascending: false })
      .limit(8),
  ]);

  if (bankResult.error) throw new Error(bankResult.error.message);
  if (!bankResult.data) notFound();

  const bank = bankResult.data as BankRow;
  const sessions = sessionsResult.error ? [] : ((sessionsResult.data || []) as TestSessionRow[]);
  const sessionHistoryUnavailable = Boolean(sessionsResult.error);

  const totalQuestions = outline.reduce((sum, category) => sum + category.total, 0);
  const answered = outline.reduce((sum, category) => sum + category.attempted, 0);
  const incorrect = outline.reduce((sum, category) => sum + category.incorrectCount, 0);
  const correct = Math.max(answered - incorrect, 0);
  const accuracy = answered > 0 ? (correct / answered) * 100 : null;

  const completedScores = sessions
    .filter((session) => session.is_completed && session.score_percentage !== null)
    .map((session) => Number(session.score_percentage));
  const recentAverage = completedScores.length > 0
    ? completedScores.reduce((sum, score) => sum + score, 0) / completedScores.length
    : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-12">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-600">Live question bank</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{bank.name}</h1>
            {bank.description && (
              <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">{bank.description}</p>
            )}
          </div>
          <Link
            href={`/bank/${parsedBankId}/question-bank`}
            className="rounded-lg bg-blue-600 px-4 py-2 text-center text-xs font-bold text-white hover:bg-blue-700"
          >
            Open question bank
          </Link>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Questions" value={totalQuestions.toLocaleString()} />
        <Metric label="Categories" value={outline.length.toLocaleString()} />
        <Metric label="Answered" value={answered.toLocaleString()} />
        <Metric label="Accuracy" value={accuracy === null ? '—' : `${accuracy.toFixed(1)}%`} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="font-bold text-slate-900 dark:text-white">Recent sessions</h2>
            <p className="mt-1 text-xs text-slate-500">Latest real sessions recorded for your account in this bank.</p>
          </div>
          <span className="text-xs font-semibold text-slate-500">
            Recent completed avg: {recentAverage === null ? '—' : `${recentAverage.toFixed(1)}%`}
          </span>
        </div>

        {sessionHistoryUnavailable ? (
          <div className="p-8 text-center text-sm text-amber-600 dark:text-amber-300">
            Session history is temporarily unavailable. The question bank itself is still ready to use.
          </div>
        ) : sessions.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No sessions yet. Start from the question bank to create your first real session.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {sessions.map((session) => (
              <div key={session.id} className="grid grid-cols-2 gap-3 px-5 py-4 text-xs sm:grid-cols-5">
                <div>
                  <p className="text-slate-500">Started</p>
                  <p className="mt-1 font-semibold text-slate-900 dark:text-white">{formatDate(session.started_at)}</p>
                </div>
                <div>
                  <p className="text-slate-500">Type</p>
                  <p className="mt-1 font-semibold text-slate-900 dark:text-white">{session.session_type || 'Standard'}</p>
                </div>
                <div>
                  <p className="text-slate-500">Questions</p>
                  <p className="mt-1 font-semibold text-slate-900 dark:text-white">{session.total_questions}</p>
                </div>
                <div>
                  <p className="text-slate-500">Score</p>
                  <p className="mt-1 font-semibold text-slate-900 dark:text-white">
                    {session.score_percentage === null ? '—' : `${Number(session.score_percentage).toFixed(1)}%`}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Status</p>
                  <p className="mt-1 font-semibold text-slate-900 dark:text-white">
                    {session.is_completed ? `Completed ${formatDate(session.completed_at)}` : 'In progress'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}

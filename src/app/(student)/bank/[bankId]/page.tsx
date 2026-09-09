import React from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getBankDetails } from '@/actions/pathways';
import { createClient } from '@/lib/supabase/server';
import {
  getLiveQuestionBankOutline,
  QuestionBankAccessError,
  QuestionBankAuthenticationError,
} from '@/lib/question-bank';

export default async function QuestionBankHomePage({
  params,
}: {
  params: Promise<{ bankId: string }>;
}) {
  const { bankId } = await params;
  const parsedBankId = Number(bankId);
  if (!Number.isInteger(parsedBankId) || parsedBankId <= 0) notFound();

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

  const bank = await getBankDetails(parsedBankId);
  if (!bank) notFound();

  const totalQuestions = outline.reduce((sum, category) => sum + category.total, 0);
  const attempted = outline.reduce((sum, category) => sum + category.attempted, 0);
  const incorrect = outline.reduce((sum, category) => sum + category.incorrectCount, 0);
  const flagged = outline.reduce((sum, category) => sum + category.flaggedCount, 0);
  const suspended = outline.reduce((sum, category) => sum + category.suspendedCount, 0);
  const newQuestions = outline.reduce((sum, category) => sum + category.newCount, 0);
  const correct = Math.max(0, attempted - incorrect);
  const accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=/bank/${parsedBankId}`);

  const { data: sessions, error: sessionError } = await supabase
    .from('test_sessions')
    .select('id,started_at,is_completed,score_percentage,total_questions')
    .eq('user_id', user.id)
    .eq('question_bank_id', parsedBankId)
    .order('started_at', { ascending: false })
    .limit(5);

  if (sessionError) throw new Error(sessionError.message);
  const latestSession = sessions?.[0] || null;

  return (
    <div className="mx-auto max-w-[1048px] space-y-5 text-[12px] text-white">
      <section className="rounded-lg border border-[#46515a] bg-[#353c42] p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8ab7c8]">{bank.pathwayName}</p>
            <h1 className="mt-1 text-[25px] font-semibold text-white">{bank.name}</h1>
            {bank.description && <p className="mt-2 max-w-[680px] text-[13px] leading-5 text-[#c9d1d6]">{bank.description}</p>}
          </div>
          <div className="flex gap-2">
            <Link href={`/pathway/${bank.pathwaySlug}`} className="rounded border border-[#73818a] px-3 py-2 text-[#d8e0e5] hover:bg-[#404950]">Pathway</Link>
            <Link href={`/bank/${parsedBankId}/question-bank`} className="rounded bg-[#d5e4ff] px-4 py-2 font-semibold text-[#102148] hover:bg-[#e2ecff]">Open Question Bank</Link>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Metric label="Questions" value={totalQuestions.toLocaleString()} />
        <Metric label="Attempted" value={attempted.toLocaleString()} />
        <Metric label="Accuracy" value={`${accuracy}%`} />
        <Metric label="Incorrect" value={incorrect.toLocaleString()} />
        <Metric label="Flagged" value={flagged.toLocaleString()} />
        <Metric label="New" value={newQuestions.toLocaleString()} />
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <article className="rounded-lg bg-[#353c42] p-5 shadow-sm">
          <h2 className="text-[14px] font-semibold">Live learning data</h2>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-[12px]">
            <DataPoint label="Mapped categories" value={outline.length.toString()} />
            <DataPoint label="Suspended questions" value={suspended.toLocaleString()} />
            <DataPoint label="Library articles" value={bank.textbookArticleCount.toLocaleString()} />
            <DataPoint label="Premium access" value={bank.hasPremiumAccess ? 'Active' : 'Trial / limited'} />
          </dl>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href={`/bank/${parsedBankId}/performance`} className="rounded border border-[#66757e] px-3 py-2 text-[#e3e8eb] hover:bg-[#404950]">Performance</Link>
            <Link href={`/bank/${parsedBankId}/review`} className="rounded border border-[#66757e] px-3 py-2 text-[#e3e8eb] hover:bg-[#404950]">Review</Link>
            {bank.textbookArticleCount > 0 && <Link href={`/bank/${parsedBankId}/textbook/high-yield`} className="rounded border border-[#66757e] px-3 py-2 text-[#e3e8eb] hover:bg-[#404950]">Textbook</Link>}
          </div>
        </article>

        <article className="rounded-lg bg-[#353c42] p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[14px] font-semibold">Recent sessions</h2>
            <Link href={`/bank/${parsedBankId}/fixed-sets`} className="text-[11px] font-semibold text-[#cda9ff] hover:underline">View all</Link>
          </div>
          {sessions && sessions.length > 0 ? (
            <div className="mt-4 space-y-2">
              {sessions.map((session) => (
                <div key={session.id} className="flex items-center justify-between gap-3 rounded border border-[#485158] bg-[#30363b] px-3 py-2">
                  <div>
                    <p className="font-medium text-white">{session.total_questions} questions</p>
                    <p className="text-[10px] text-[#9ca8af]">{new Date(session.started_at).toLocaleString()}</p>
                  </div>
                  <span className="text-[11px] text-[#cbd4d9]">
                    {session.is_completed ? (session.score_percentage === null ? 'Completed' : `${Math.round(session.score_percentage)}%`) : 'In progress'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded border border-dashed border-[#56636c] p-5 text-center text-[#aeb9bf]">No sessions yet. Start from the live question bank.</div>
          )}
          {latestSession && !latestSession.is_completed && (
            <Link href={`/exam/${latestSession.id}`} className="mt-4 inline-flex rounded bg-[#d5e4ff] px-3 py-2 font-semibold text-[#102148] hover:bg-[#e2ecff]">Resume latest session</Link>
          )}
        </article>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-[#353c42] p-4"><p className="text-[10px] uppercase tracking-wide text-[#87949c]">{label}</p><p className="mt-1 text-[18px] font-semibold text-white">{value}</p></div>;
}

function DataPoint({ label, value }: { label: string; value: string }) {
  return <div className="rounded border border-[#485158] bg-[#30363b] p-3"><dt className="text-[10px] uppercase text-[#87949c]">{label}</dt><dd className="mt-1 font-semibold text-white">{value}</dd></div>;
}

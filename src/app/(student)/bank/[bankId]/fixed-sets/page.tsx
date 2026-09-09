import React from 'react';
import { notFound, redirect } from 'next/navigation';
import {
  PreviousSessionsClient,
  type PreviousSession,
} from '@/components/bank/PreviousSessionsClient';
import { createClient } from '@/lib/supabase/server';

interface TestSessionRow {
  id: string;
  started_at: string;
  categories: string[] | null;
  total_questions: number;
  session_type: PreviousSession['session_type'];
  is_completed: boolean;
  score_percentage: number | null;
}

interface SessionAnswerRow {
  test_session_id: string;
}

export default async function FixedSetsPage({
  params,
}: {
  params: Promise<{ bankId: string }>;
}) {
  const { bankId } = await params;
  const parsedBankId = Number(bankId);

  if (!Number.isInteger(parsedBankId) || parsedBankId <= 0) {
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?redirect=/bank/${parsedBankId}/fixed-sets`);
  }

  // Previous Sessions is owned history. It intentionally does not require a
  // currently-active bank grant; RLS limits the rows to the authenticated owner.
  const { data: sessions, error: sessionsError } = await supabase
    .from('test_sessions')
    .select('id, started_at, categories, total_questions, session_type, is_completed, score_percentage')
    .eq('question_bank_id', parsedBankId)
    .eq('user_id', user.id)
    .order('started_at', { ascending: false });

  if (sessionsError) {
    throw new Error(sessionsError.message);
  }

  const sessionRows = (sessions || []) as TestSessionRow[];
  const sessionIds = sessionRows.map((session) => session.id);
  const answeredCounts = new Map<string, number>();

  if (sessionIds.length > 0) {
    // Read only a safe ownership/link column instead of a nested count query.
    // This remains compatible with column-level restrictions on answer details.
    const { data: answerRows, error: answersError } = await supabase
      .from('user_answers')
      .select('test_session_id')
      .in('test_session_id', sessionIds);

    if (answersError) {
      throw new Error(answersError.message);
    }

    for (const answer of (answerRows || []) as SessionAnswerRow[]) {
      answeredCounts.set(
        answer.test_session_id,
        (answeredCounts.get(answer.test_session_id) || 0) + 1,
      );
    }
  }

  const mappedSessions: PreviousSession[] = sessionRows.map((session) => ({
    id: session.id,
    created_at: session.started_at,
    categories: session.categories,
    total_questions: session.total_questions,
    session_type: session.session_type,
    is_completed: session.is_completed,
    score_percentage: session.score_percentage,
    answeredCount: answeredCounts.get(session.id) || 0,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[#111827]">Previous Sessions</h1>
      </div>
      <PreviousSessionsClient sessions={mappedSessions} bankId={parsedBankId} />
    </div>
  );
}

import React from 'react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { OldBlocksClient, OldBlockSession } from '@/components/bank/OldBlocksClient';

interface TestSessionRow {
  id: string;
  started_at: string;
  categories: string[] | null;
  total_questions: number;
  session_type: OldBlockSession['session_type'];
  is_completed: boolean;
  score_percentage: number | null;
  user_answers?: Array<{ count: number }> | null;
}

export default async function FixedSetsPage({
  params,
}: {
  params: Promise<{ bankId: string }>;
}) {
  const { bankId } = await params;
  const parsedBankId = Number(bankId || 1);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch test sessions for this user and bank
  const { data: sessions, error } = await supabase
    .from('test_sessions')
    .select(`
      *,
      user_answers(count)
    `)
    .eq('question_bank_id', parsedBankId)
    .eq('user_id', user.id)
    .order('started_at', { ascending: false });

  if (error) {
    console.error('Error fetching sessions:', error);
  }

  const mappedSessions: OldBlockSession[] = ((sessions || []) as TestSessionRow[]).map((session) => ({
    id: session.id,
    created_at: session.started_at,
    categories: session.categories,
    total_questions: session.total_questions,
    session_type: session.session_type,
    is_completed: session.is_completed,
    score_percentage: session.score_percentage,
    answeredCount: session.user_answers?.[0]?.count || 0,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[#111827]">Old Blocks</h1>
      </div>
      <OldBlocksClient sessions={mappedSessions} bankId={parsedBankId} />
    </div>
  );
}

import { getExamSession, getFullExamSession } from '@/actions/exam';
import { ExamPageClient } from '@/components/exam/ExamPageClient';
import { createClient } from '@/lib/supabase/server';
import type { ExamClientAnswer } from '@/types/exam';
import { notFound, redirect } from 'next/navigation';

interface RawExamAnswer {
  question_id: number;
  selected_option_id: number | null;
  is_correct: boolean | null;
  correct_option_id: number | null;
  time_spent_seconds: number | null;
}

interface ExamPageProps {
  params: Promise<{
    sessionId: string;
  }>;
}

export default async function ExamPage({ params }: ExamPageProps) {
  const { sessionId } = await params;

  // Read owned session metadata first. Historical metadata remains readable after
  // access expiry, but resuming an unfinished block requires current bank access.
  const sessionMeta = await getExamSession(sessionId);
  if (!sessionMeta) {
    notFound();
  }

  const bankId = Number(sessionMeta.question_bank_id);
  if (!Number.isInteger(bankId) || bankId <= 0) {
    notFound();
  }

  if (sessionMeta.is_completed) {
    redirect(`/bank/${bankId}/fixed-sets`);
  }

  const supabase = await createClient();
  const { data: canAccess, error: accessError } = await supabase.rpc('can_access_question_bank', {
    p_bank_id: bankId,
  });

  if (accessError || canAccess !== true) {
    // Keep the unfinished block visible as owned history, but do not load its
    // question content or allow resume until current bank access is restored.
    redirect(`/bank/${bankId}/fixed-sets`);
  }

  const fullData = await getFullExamSession(sessionId);
  if (!fullData) {
    notFound();
  }

  // Handle a completion that raced with the metadata read above.
  if (fullData.status === 'completed') {
    redirect(`/bank/${fullData.bankId}/fixed-sets`);
  }

  const { initialQuestions, rawAnswers, session, flaggedQuestionIds } = fullData;
  const initialAnswers: Record<number, ExamClientAnswer> = {};

  rawAnswers.forEach((answer: RawExamAnswer) => {
    if (answer.selected_option_id == null) return;

    initialAnswers[answer.question_id] = {
      questionId: answer.question_id,
      selectedOptionId: answer.selected_option_id,
      isCorrect: typeof answer.is_correct === 'boolean' ? answer.is_correct : null,
      correctOptionId: answer.correct_option_id == null ? null : answer.correct_option_id,
      timeSpentSeconds: answer.time_spent_seconds || 0,
    };
  });

  return (
    <ExamPageClient
      initialQuestions={initialQuestions}
      sessionId={sessionId}
      initialAnswers={initialAnswers}
      initialFlaggedQuestionIds={flaggedQuestionIds}
      session={session}
    />
  );
}

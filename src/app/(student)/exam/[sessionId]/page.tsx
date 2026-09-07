import { getFullExamSession } from '@/actions/exam';
import { ExamPageClient } from '@/components/exam/ExamPageClient';
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
  const fullData = await getFullExamSession(sessionId);

  if (!fullData) {
    notFound();
  }

  if (fullData.status === 'completed') {
    if (!Number.isInteger(fullData.bankId) || fullData.bankId <= 0) {
      notFound();
    }

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

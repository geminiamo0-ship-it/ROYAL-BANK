import { getFullExamSession } from '@/actions/exam';
import { ExamPageClient } from '@/components/exam/ExamPageClient';
import type { UserExamAnswer } from '@/stores/examStore';
import { notFound } from 'next/navigation';

interface RawExamAnswer {
  question_id: number;
  selected_option_id: number | null;
  is_correct: boolean;
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

  const { initialQuestions, rawAnswers, session, flaggedQuestionIds } = fullData;
  const initialAnswers: Record<number, UserExamAnswer> = {};

  rawAnswers.forEach((answer: RawExamAnswer) => {
    if (answer.selected_option_id == null) return;

    initialAnswers[answer.question_id] = {
      questionId: answer.question_id,
      selectedOptionId: answer.selected_option_id,
      isCorrect: answer.is_correct,
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

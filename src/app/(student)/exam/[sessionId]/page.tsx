import { WindowedExamPageClient } from '@/components/exam/WindowedExamPageClient';

interface ExamPageProps {
  params: Promise<{
    sessionId: string;
  }>;
}

export default async function ExamPage({ params }: ExamPageProps) {
  const { sessionId } = await params;
  return <WindowedExamPageClient sessionId={sessionId} />;
}

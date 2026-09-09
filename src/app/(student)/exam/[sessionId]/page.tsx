import { WindowedExamPageClient } from '@/components/exam/WindowedExamPageClient';

interface ExamPageProps {
  params: Promise<{
    sessionId: string;
  }>;
  searchParams: Promise<{
    review?: string | string[];
  }>;
}

export default async function ExamPage({ params, searchParams }: ExamPageProps) {
  const [{ sessionId }, query] = await Promise.all([params, searchParams]);
  const reviewValue = Array.isArray(query.review) ? query.review[0] : query.review;
  return <WindowedExamPageClient sessionId={sessionId} reviewMode={reviewValue === '1'} />;
}

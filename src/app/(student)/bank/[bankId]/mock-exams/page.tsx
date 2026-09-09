import { LiveDataUnavailable } from '@/components/bank/LiveDataUnavailable';

export default async function MockExamsPage({ params }: { params: Promise<{ bankId: string }> }) {
  const { bankId } = await params;
  return <LiveDataUnavailable bankId={bankId} title="Mock Exams" description="There is no production mock-exam catalog attached to this bank yet. Fabricated exams, benchmarks and timers have been removed." />;
}

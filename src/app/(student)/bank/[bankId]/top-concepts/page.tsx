import { LiveDataUnavailable } from '@/components/bank/LiveDataUnavailable';

export default async function TopConceptsPage({ params }: { params: Promise<{ bankId: string }> }) {
  const { bankId } = await params;
  return <LiveDataUnavailable bankId={bankId} title="Top Concepts" description="There is no production ranking source for top concepts yet. This page no longer displays fabricated rankings or frequencies." />;
}

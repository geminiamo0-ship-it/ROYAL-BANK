import { LiveDataUnavailable } from '@/components/bank/LiveDataUnavailable';

export default async function ReviewFactsPage({ params }: { params: Promise<{ bankId: string }> }) {
  const { bankId } = await params;
  return <LiveDataUnavailable bankId={bankId} title="Review Facts" description="There is no production fact-curation source for this bank yet. Fabricated high-yield facts have been removed." />;
}

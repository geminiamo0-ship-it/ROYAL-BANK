import { LiveDataUnavailable } from '@/components/bank/LiveDataUnavailable';

export default async function FixedSetsPage({ params }: { params: Promise<{ bankId: string }> }) {
  const { bankId } = await params;
  return <LiveDataUnavailable bankId={bankId} title="Previous Fixed Sets" description="The legacy fixed-set session model is not part of the production schema. This screen no longer queries legacy tables or displays non-production session data." />;
}

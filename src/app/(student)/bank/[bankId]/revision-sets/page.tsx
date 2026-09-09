import { LiveDataUnavailable } from '@/components/bank/LiveDataUnavailable';

export default async function RevisionSetsPage({ params }: { params: Promise<{ bankId: string }> }) {
  const { bankId } = await params;
  return <LiveDataUnavailable bankId={bankId} title="Custom Revision Sets" description="Revision-set persistence is not implemented in the production database yet, so this page no longer implies that custom sets can be created or saved." />;
}

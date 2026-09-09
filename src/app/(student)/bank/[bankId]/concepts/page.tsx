import { LiveDataUnavailable } from '@/components/bank/LiveDataUnavailable';

export default async function AllConceptsPage({ params }: { params: Promise<{ bankId: string }> }) {
  const { bankId } = await params;
  return <LiveDataUnavailable bankId={bankId} title="Clinical Concepts" description="The current production concept data is not scoped to this bank in a way this screen can safely present, so no synthetic concept list is shown." />;
}

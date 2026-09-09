import { LiveDataUnavailable } from '@/components/bank/LiveDataUnavailable';

export default async function SavedConceptsPage({ params }: { params: Promise<{ bankId: string }> }) {
  const { bankId } = await params;
  return <LiveDataUnavailable bankId={bankId} title="Saved Concepts" description="Saved-concept persistence is not present in the production schema. Sample bookmarks and demo question links have been removed." />;
}

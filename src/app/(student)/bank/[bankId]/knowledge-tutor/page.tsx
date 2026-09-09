import { LiveDataUnavailable } from '@/components/bank/LiveDataUnavailable';

export default async function KnowledgeTutorPage({ params }: { params: Promise<{ bankId: string }> }) {
  const { bankId } = await params;
  return <LiveDataUnavailable bankId={bankId} title="Knowledge Tutor" description="A production-backed tutor feed has not been implemented yet, so sample flashcards have been removed from this screen." />;
}

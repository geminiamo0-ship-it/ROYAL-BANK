import { LiveDataUnavailable } from '@/components/bank/LiveDataUnavailable';

export default async function CommentThreadsPage({ params }: { params: Promise<{ bankId: string }> }) {
  const { bankId } = await params;
  return <LiveDataUnavailable bankId={bankId} title="Comment Threads" description="Royal does not currently have a production comments data source for this bank, so fake discussions have been removed." />;
}

import { LiveDataUnavailable } from '@/components/bank/LiveDataUnavailable';

export default async function ContentMapPage({ params }: { params: Promise<{ bankId: string }> }) {
  const { bankId } = await params;
  return <LiveDataUnavailable bankId={bankId} title="Clinical Content Map" description="A live clinical hierarchy has not been modeled in the production database yet, so this screen will stay empty until a real source is available." />;
}

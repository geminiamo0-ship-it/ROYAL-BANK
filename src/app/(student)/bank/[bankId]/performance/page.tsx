import { notFound, redirect } from 'next/navigation';

export default async function RetiredPerformancePage({
  params,
}: {
  params: Promise<{ bankId: string }>;
}) {
  const { bankId } = await params;
  const parsedBankId = Number(bankId);
  if (!Number.isInteger(parsedBankId) || parsedBankId <= 0) notFound();
  redirect(`/bank/${parsedBankId}`);
}

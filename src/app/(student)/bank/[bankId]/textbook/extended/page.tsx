import { notFound, redirect } from 'next/navigation';

interface ExtendedTextbookPageProps {
  params: Promise<{
    bankId: string;
  }>;
}

export default async function ExtendedTextbookPage({ params }: ExtendedTextbookPageProps) {
  const { bankId } = await params;
  const parsedBankId = Number(bankId);

  if (!Number.isInteger(parsedBankId) || parsedBankId <= 0) {
    notFound();
  }

  redirect(`/bank/${parsedBankId}/textbook/high-yield`);
}

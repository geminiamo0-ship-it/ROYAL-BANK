import { notFound, redirect } from 'next/navigation';
import { QuestionBankPageClient } from '@/components/bank/QuestionBankPageClient';
import { getBankDetails } from '@/actions/pathways';
import { getLiveQuestionBankOutline } from '@/lib/question-bank';

interface QuestionBankPageProps {
  params: Promise<{
    bankId: string;
  }>;
}

export default async function QuestionBankPage({ params }: QuestionBankPageProps) {
  const { bankId } = await params;
  const parsedBankId = Number(bankId);

  if (!Number.isInteger(parsedBankId) || parsedBankId <= 0) {
    notFound();
  }

  const bank = await getBankDetails(parsedBankId);
  if (!bank) {
    notFound();
  }

  if (!bank.isUnlocked) {
    redirect('/dashboard?upgrade=true');
  }

  const initialCategories = await getLiveQuestionBankOutline(parsedBankId);

  return (
    <QuestionBankPageClient
      bankId={parsedBankId}
      initialCategories={initialCategories}
    />
  );
}

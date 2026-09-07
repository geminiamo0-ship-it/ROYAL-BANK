import { notFound, redirect } from 'next/navigation';
import { QuestionBankPageClient } from '@/components/bank/QuestionBankPageClient';
import {
  getLiveQuestionBankOutline,
  QuestionBankAccessError,
  QuestionBankAuthenticationError,
} from '@/lib/question-bank';

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

  let initialCategories;
  try {
    initialCategories = await getLiveQuestionBankOutline(parsedBankId);
  } catch (error) {
    if (error instanceof QuestionBankAuthenticationError) {
      redirect(`/login?redirect=/bank/${parsedBankId}/question-bank`);
    }

    if (error instanceof QuestionBankAccessError) {
      redirect('/dashboard?upgrade=true');
    }

    throw error;
  }

  return (
    <QuestionBankPageClient
      bankId={parsedBankId}
      initialCategories={initialCategories}
    />
  );
}

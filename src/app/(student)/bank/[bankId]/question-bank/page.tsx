import { QuestionBankPageClient } from '@/components/bank/QuestionBankPageClient';
import { getLiveQuestionBankOutline } from '@/lib/question-bank';

interface QuestionBankPageProps {
  params: Promise<{
    bankId: string;
  }>;
}

export default async function QuestionBankPage({ params }: QuestionBankPageProps) {
  const { bankId } = await params;
  const parsedBankId = Number(bankId || 1);
  const initialCategories = await getLiveQuestionBankOutline(parsedBankId);

  return (
    <QuestionBankPageClient
      bankId={parsedBankId}
      initialCategories={initialCategories}
    />
  );
}

import { notFound, redirect } from 'next/navigation';
import { RevisionQuestionsClient } from '@/components/bank/RevisionQuestionsClient';
import {
  getLiveQuestionBankOutline,
  QuestionBankAccessError,
  QuestionBankAuthenticationError,
} from '@/lib/question-bank';
import { getRevisionIndex, normalizeRevisionFilters } from '@/lib/revision';

export default async function ReviewQuestionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ bankId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ bankId }, query] = await Promise.all([params, searchParams]);
  const parsedBankId = Number(bankId);
  if (!Number.isInteger(parsedBankId) || parsedBankId <= 0) notFound();

  try {
    await getLiveQuestionBankOutline(parsedBankId);
  } catch (error) {
    if (error instanceof QuestionBankAuthenticationError) {
      redirect(`/login?redirect=/bank/${parsedBankId}/review`);
    }
    if (error instanceof QuestionBankAccessError) {
      redirect(`/upgrade?bank=${parsedBankId}`);
    }
    throw error;
  }

  const filters = normalizeRevisionFilters(query);
  const index = await getRevisionIndex(parsedBankId, filters);

  return (
    <RevisionQuestionsClient
      bankId={parsedBankId}
      index={index}
      filters={filters}
    />
  );
}

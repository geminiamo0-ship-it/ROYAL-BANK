import { notFound, redirect } from 'next/navigation';
import { PreviousSessionsClient } from '@/components/bank/PreviousSessionsClient';
import {
  BankPerformanceAccessError,
  BankPerformanceAuthenticationError,
  getLiveBankSessions,
} from '@/lib/bank-performance';

export default async function PreviousSessionsPage({
  params,
}: {
  params: Promise<{ bankId: string }>;
}) {
  const { bankId } = await params;
  const parsedBankId = Number(bankId);
  if (!Number.isInteger(parsedBankId) || parsedBankId <= 0) notFound();

  let sessions;
  try {
    sessions = await getLiveBankSessions(parsedBankId, 100);
  } catch (error) {
    if (error instanceof BankPerformanceAuthenticationError) {
      redirect(`/login?redirect=/bank/${parsedBankId}/sessions`);
    }
    if (error instanceof BankPerformanceAccessError) {
      redirect(`/upgrade?bank=${parsedBankId}`);
    }
    throw error;
  }

  return (
    <PreviousSessionsClient
      bankId={parsedBankId}
      sessions={sessions.map((session) => ({
        ...session,
        answeredCount: session.answered_count,
      }))}
    />
  );
}

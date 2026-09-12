import { notFound, redirect } from 'next/navigation';
import { BankHero, BankPerformanceDashboard } from '@/components/bank/BankPerformanceDashboard';
import {
  BankPerformanceAccessError,
  BankPerformanceAuthenticationError,
  getLiveBankPerformance,
} from '@/lib/bank-performance';

export default async function QuestionBankHomePage({
  params,
}: {
  params: Promise<{ bankId: string }>;
}) {
  const { bankId } = await params;
  const parsedBankId = Number(bankId);
  if (!Number.isInteger(parsedBankId) || parsedBankId <= 0) notFound();

  let performance;
  try {
    performance = await getLiveBankPerformance(parsedBankId);
  } catch (error) {
    if (error instanceof BankPerformanceAuthenticationError) {
      redirect(`/login?redirect=/bank/${parsedBankId}`);
    }
    if (error instanceof BankPerformanceAccessError) {
      redirect('/dashboard?access=denied');
    }
    throw error;
  }

  return (
    <div className="mx-auto max-w-[1048px] space-y-[18px] pb-14 text-[12px] text-white">
      <BankHero bankId={parsedBankId} bankName={performance.bank_name} performance={performance} />

      {performance.bank_description ? (
        <section className="rounded-[4px] border border-[#414a52] bg-[#30373d] px-4 py-3 text-[11px] leading-5 text-[#c5ced4]">
          {performance.bank_description}
        </section>
      ) : null}

      <BankPerformanceDashboard bankId={parsedBankId} performance={performance} />
    </div>
  );
}

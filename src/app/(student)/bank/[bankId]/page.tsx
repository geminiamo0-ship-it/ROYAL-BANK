import { notFound, redirect } from 'next/navigation';
import { BankHero, BankPerformanceDashboard } from '@/components/bank/BankPerformanceDashboard';
import {
  BankPerformanceAccessError,
  BankPerformanceAuthenticationError,
  getLiveBankPerformance,
} from '@/lib/bank-performance';
import { createClient } from '@/lib/supabase/server';

interface BankRow {
  id: number;
  name: string;
  description: string | null;
}

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
      redirect(`/upgrade?bank=${parsedBankId}`);
    }
    throw error;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('question_banks')
    .select('id,name,description')
    .eq('id', parsedBankId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) notFound();
  const bank = data as BankRow;

  return (
    <div className="mx-auto max-w-[1048px] space-y-[18px] pb-14 text-[12px] text-white">
      <BankHero bankId={parsedBankId} bankName={bank.name} performance={performance} />

      {bank.description ? (
        <section className="rounded-[4px] border border-[#414a52] bg-[#30373d] px-4 py-3 text-[11px] leading-5 text-[#c5ced4]">
          {bank.description}
        </section>
      ) : null}

      <BankPerformanceDashboard performance={performance} />
    </div>
  );
}

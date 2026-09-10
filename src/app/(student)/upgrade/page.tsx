import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

function positiveInt(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export default async function UpgradeCompatibilityPage({
  searchParams,
}: {
  searchParams: Promise<{
    bank?: string | string[];
    pathway?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const bankId = positiveInt(params.bank);
  const pathwayId = positiveInt(params.pathway);
  const supabase = await createClient();

  if (bankId) {
    const { data: bank } = await supabase
      .from('question_banks')
      .select('id,pathway_id')
      .eq('id', bankId)
      .maybeSingle();

    if (bank) {
      const { data: pathway } = await supabase
        .from('pathways')
        .select('slug')
        .eq('id', bank.pathway_id)
        .maybeSingle();
      if (pathway?.slug) redirect(`/pathway/${pathway.slug}?upgradeBank=${bank.id}`);
    }
  }

  if (pathwayId) {
    const { data: pathway } = await supabase
      .from('pathways')
      .select('id,slug')
      .eq('id', pathwayId)
      .maybeSingle();
    if (pathway?.slug) redirect(`/pathway/${pathway.slug}?upgradePathway=${pathway.id}`);
  }

  redirect('/dashboard?upgradeGlobal=1');
}

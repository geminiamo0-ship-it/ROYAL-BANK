import 'server-only';

import { unstable_cache } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';

export interface BankQuestionRow {
  category: string;
  topic: string | null;
  difficulty: string;
  total_questions: number;
}

const getCachedBankQuestionRows = unstable_cache(
  async (bankId: number) => {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('get_category_topic_counts_json', { p_bank_id: bankId });

    if (error) {
      console.error('Error fetching category counts:', error);
      throw new Error('Failed to fetch category counts');
    }

    if (!data || !Array.isArray(data)) {
      return [];
    }

    return data as BankQuestionRow[];
  },
  ['bank-question-rows-rpc-v3'],
  {
    revalidate: 3600, // 1 hour
    tags: ['bank-question-rows-rpc-v3'],
  }
);

export async function getBankQuestionRows(bankId: number) {
  return getCachedBankQuestionRows(bankId);
}

'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getLiveQuestionBankCategories } from '@/lib/question-bank';
import type { CategorySummary } from '@/types/exam';

export type { CategorySummary } from '@/types/exam';

export async function getQuestionBankCategories(bankId: number): Promise<CategorySummary[]> {
  return getLiveQuestionBankCategories(bankId);
}

export async function saveConceptVote(input: {
  questionId: number;
  conceptText: string;
  isImportant: boolean;
}): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { error } = await supabase.from('saved_concepts').upsert(
    {
      user_id: user.id,
      question_id: input.questionId,
      concept_text: input.conceptText,
      is_important: input.isImportant,
      saved_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,question_id' },
  );

  if (error) throw new Error(error.message);
}

export async function removeSavedConcept(questionId: number): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { error } = await supabase
    .from('saved_concepts')
    .delete()
    .eq('user_id', user.id)
    .eq('question_id', questionId);

  if (error) throw new Error(error.message);
}

export async function deleteSession(sessionId: string, currentPath: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' };

  const { error } = await supabase
    .from('test_sessions')
    .delete()
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .eq('is_completed', false);

  if (error) return { error: error.message };

  revalidatePath(currentPath);
  return { success: true };
}

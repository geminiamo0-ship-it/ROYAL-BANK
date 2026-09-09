import React from 'react';
import { notFound, redirect } from 'next/navigation';
import { SavedConceptsClient, type SavedConceptView } from '@/components/bank/SavedConceptsClient';
import { createClient } from '@/lib/supabase/server';

interface SavedConceptRow {
  id: number;
  question_id: number;
  concept_text: string;
  is_important: boolean;
  saved_at: string;
}

export default async function SavedConceptsPage({ params }: { params: Promise<{ bankId: string }> }) {
  const { bankId } = await params;
  const parsedBankId = Number(bankId);
  if (!Number.isInteger(parsedBankId) || parsedBankId <= 0) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=/bank/${parsedBankId}/saved-concepts`);

  const { data: savedRows, error: savedError } = await supabase
    .from('saved_concepts')
    .select('id,question_id,concept_text,is_important,saved_at')
    .eq('user_id', user.id)
    .order('saved_at', { ascending: false });

  if (savedError) throw new Error(savedError.message);
  const saved = (savedRows || []) as SavedConceptRow[];

  let bankQuestionIds = new Set<number>();
  if (saved.length > 0) {
    const { data: mappings, error: mappingError } = await supabase
      .from('question_bank_questions')
      .select('question_id')
      .eq('question_bank_id', parsedBankId)
      .in('question_id', saved.map((row) => row.question_id));

    if (mappingError) throw new Error(mappingError.message);
    bankQuestionIds = new Set((mappings || []).map((row) => Number(row.question_id)));
  }

  const items: SavedConceptView[] = saved
    .filter((row) => bankQuestionIds.has(row.question_id))
    .map((row) => ({
      id: row.id,
      questionId: row.question_id,
      conceptText: row.concept_text,
      isImportant: row.is_important,
      savedAt: row.saved_at,
    }));

  return <SavedConceptsClient bankId={parsedBankId} initialItems={items} />;
}

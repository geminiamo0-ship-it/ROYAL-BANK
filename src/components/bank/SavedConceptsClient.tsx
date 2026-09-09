'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { BookOpen, Sparkles, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react';
import { removeSavedConcept } from '@/actions/exam';

export interface SavedConceptView {
  id: number;
  questionId: number;
  conceptText: string;
  isImportant: boolean;
  savedAt: string;
}

export function SavedConceptsClient({ bankId, initialItems }: { bankId: number; initialItems: SavedConceptView[] }) {
  const [filter, setFilter] = useState<'all' | 'important' | 'less_important'>('all');
  const [items, setItems] = useState(initialItems);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredItems = items.filter((item) =>
    filter === 'all' ? true : filter === 'important' ? item.isImportant : !item.isImportant,
  );

  const remove = (questionId: number) => {
    setError(null);
    startTransition(async () => {
      try {
        await removeSavedConcept(questionId);
        setItems((current) => current.filter((item) => item.questionId !== questionId));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to remove saved concept.');
      }
    });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-16 text-xs sm:text-sm">
      <div className="flex flex-col gap-4 rounded-xl border border-slate-700 bg-[#353c42] p-5 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-950/60 text-amber-300"><Sparkles className="h-5 w-5" /></div>
          <div><h1 className="text-lg font-bold text-white">Saved Concepts</h1><p className="text-xs text-slate-300">Concepts you actually saved while answering questions in this bank.</p></div>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-[#2d3338] p-1">
          <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>All ({items.length})</FilterButton>
          <FilterButton active={filter === 'important'} onClick={() => setFilter('important')}><ThumbsUp className="h-3 w-3" /> Important</FilterButton>
          <FilterButton active={filter === 'less_important'} onClick={() => setFilter('less_important')}><ThumbsDown className="h-3 w-3" /> Less</FilterButton>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-700 bg-red-950/40 p-3 text-red-200">{error}</div>}

      <div className="divide-y divide-slate-700 overflow-hidden rounded-xl border border-slate-700 bg-[#353c42] shadow-xs">
        {filteredItems.length > 0 ? filteredItems.map((item) => (
          <div key={item.id} className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className={item.isImportant ? 'font-semibold text-emerald-300' : 'text-slate-400'}>{item.isImportant ? 'Important' : 'Less important'}</span>
                <span className="text-slate-500">{new Date(item.savedAt).toLocaleString()}</span>
              </div>
              <p className="mt-2 text-sm font-semibold leading-6 text-white">{item.conceptText}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link href={`/bank/${bankId}/question-bank`} className="rounded-lg bg-slate-700 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-600">Open Question Bank</Link>
              <button type="button" disabled={isPending} onClick={() => remove(item.questionId)} className="rounded-lg p-2 text-slate-400 hover:bg-red-950/50 hover:text-red-300 disabled:opacity-50" title="Remove saved concept"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        )) : (
          <div className="p-12 text-center text-slate-400"><BookOpen className="mx-auto h-8 w-8 opacity-40" /><p className="mt-2 font-medium">No saved concepts in this bank.</p></div>
        )}
      </div>
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold ${active ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}>{children}</button>;
}

'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Sparkles,
  ThumbsUp,
  ThumbsDown,
  ArrowRight,
  Trash2,
  BookOpen,
} from 'lucide-react';

interface SavedConceptItem {
  id: number;
  questionId: number;
  conceptText: string;
  category: string;
  isImportant: boolean;
  savedAt: string;
}

const SAMPLE_SAVED: SavedConceptItem[] = [
  {
    id: 1,
    questionId: 1,
    conceptText: "Wilson's disease - serum caeruloplasmin is decreased",
    category: 'Neurology',
    isImportant: true,
    savedAt: '2 hours ago',
  },
  {
    id: 2,
    questionId: 2,
    conceptText: "Ebstein's anomaly is associated with maternal lithium use",
    category: 'Cardiology',
    isImportant: true,
    savedAt: 'Yesterday',
  },
  {
    id: 3,
    questionId: 15,
    conceptText: 'Hereditary hemochromatosis is associated with pseudogout (chondrocalcinosis)',
    category: 'Rheumatology',
    isImportant: false,
    savedAt: '3 days ago',
  },
];

export default function SavedConceptsPage() {
  const [filter, setFilter] = useState<'all' | 'important' | 'less_important'>('all');
  const [items, setItems] = useState<SavedConceptItem[]>(SAMPLE_SAVED);

  const filteredItems = items.filter((item) =>
    filter === 'all'
      ? true
      : filter === 'important'
        ? item.isImportant
        : !item.isImportant
  );

  const handleDelete = (id: number) => {
    setItems(items.filter((item) => item.id !== id));
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-16 text-xs sm:text-sm">
      <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-300 flex items-center justify-center font-bold">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">
              Saved Core Concepts
            </h1>
            <p className="text-xs text-slate-500">
              High-yield tested concepts bookmarked during your clinical question practice
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
              filter === 'all'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            All ({items.length})
          </button>
          <button
            onClick={() => setFilter('important')}
            className={`px-3 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1 ${
              filter === 'important'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 shadow-xs'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <ThumbsUp className="h-3 w-3" /> Important
          </button>
          <button
            onClick={() => setFilter('less_important')}
            className={`px-3 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1 ${
              filter === 'less_important'
                ? 'bg-white dark:bg-slate-900 text-slate-600 shadow-xs'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <ThumbsDown className="h-3 w-3" /> Less
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs divide-y divide-slate-100 dark:divide-slate-800">
        {filteredItems.length > 0 ? (
          filteredItems.map((item) => (
            <div
              key={item.id}
              className="p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors"
            >
              <div className="space-y-1.5 flex-1">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    {item.category}
                  </span>
                  {item.isImportant ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
                      <ThumbsUp className="h-3 w-3" /> Important
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
                      <ThumbsDown className="h-3 w-3" /> Less important
                    </span>
                  )}
                  <span className="text-[11px] text-slate-400">• {item.savedAt}</span>
                </div>

                <p className="font-semibold text-slate-900 dark:text-white text-sm">
                  {item.conceptText}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Link
                  href={`/exam/session-demo-${item.questionId}`}
                  className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-blue-600 hover:text-white text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-all"
                >
                  <span>Review Question</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>

                <button
                  onClick={() => handleDelete(item.id)}
                  className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                  title="Remove from saved concepts"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="p-12 text-center text-slate-400 space-y-2">
            <BookOpen className="h-8 w-8 mx-auto opacity-40" />
            <p className="font-medium text-sm">No saved concepts found.</p>
            <p className="text-xs">Concepts you vote &quot;Important&quot; during questions will appear here.</p>
          </div>
        )}
      </div>
    </div>
  );
}

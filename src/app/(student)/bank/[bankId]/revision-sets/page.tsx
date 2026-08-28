'use client';

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Wand2, Plus, Layers } from 'lucide-react';

export default function RevisionSetsPage() {
  const params = useParams();
  const bankId = params.bankId || '1';

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-16 text-xs sm:text-sm">
      <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 flex items-center justify-center font-bold">
            <Wand2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">
              Custom Revision Sets
            </h1>
            <p className="text-xs text-slate-500">
              Create and manage personalized question sets by specialty or keyword tags
            </p>
          </div>
        </div>

        <Link
          href={`/bank/${bankId}/question-bank`}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs"
        >
          <Plus className="h-4 w-4" />
          <span>Create New Set</span>
        </Link>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-8 text-center space-y-3">
        <Layers className="h-10 w-10 text-slate-400 mx-auto" />
        <h3 className="font-bold text-slate-900 dark:text-white text-base">No custom revision sets yet</h3>
        <p className="text-xs text-slate-500 max-w-sm mx-auto">
          You can create personalized revision sets from your incorrect answers or specific topics in the Question Bank.
        </p>
      </div>
    </div>
  );
}

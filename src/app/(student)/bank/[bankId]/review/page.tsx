'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { 
  RotateCcw, 
  Flag, 
  XCircle, 
  Play, 
  CheckCircle2, 
  Layers,
  ChevronRight
} from 'lucide-react';

export default function ReviewQuestionsPage() {
  const params = useParams();
  const bankId = params.bankId || '1';

  const [selectedFilter, setSelectedFilter] = useState<'incorrect' | 'flagged' | 'all_attempted'>('incorrect');

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-16 text-xs sm:text-sm">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 flex items-center justify-center font-bold">
            <RotateCcw className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">
              Targeted Question Review
            </h1>
            <p className="text-xs text-slate-500">
              Spaced repetition queue targeting questions you previously got wrong or flagged
            </p>
          </div>
        </div>

        <Link
          href={`/exam/review-${selectedFilter}`}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition-colors"
        >
          <Play className="h-3.5 w-3.5 fill-current" />
          <span>Start Review Session</span>
        </Link>
      </div>

      {/* Filter Tabs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <button
          onClick={() => setSelectedFilter('incorrect')}
          className={`p-5 rounded-xl border text-left transition-all cursor-pointer ${
            selectedFilter === 'incorrect'
              ? 'border-red-500 bg-red-50/20 dark:bg-red-950/20 ring-1 ring-red-500'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <XCircle className="h-5 w-5 text-red-500" />
            <span className="font-extrabold text-xl text-slate-900 dark:text-white">12</span>
          </div>
          <h3 className="font-bold text-slate-900 dark:text-white text-sm">Previously Incorrect</h3>
          <p className="text-xs text-slate-500 mt-1">Questions you answered wrong during previous tests</p>
        </button>

        <button
          onClick={() => setSelectedFilter('flagged')}
          className={`p-5 rounded-xl border text-left transition-all cursor-pointer ${
            selectedFilter === 'flagged'
              ? 'border-amber-500 bg-amber-50/20 dark:bg-amber-950/20 ring-1 ring-amber-500'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <Flag className="h-5 w-5 text-amber-500" />
            <span className="font-extrabold text-xl text-slate-900 dark:text-white">8</span>
          </div>
          <h3 className="font-bold text-slate-900 dark:text-white text-sm">Flagged for Review</h3>
          <p className="text-xs text-slate-500 mt-1">Questions you marked with 🚩 while practicing</p>
        </button>

        <button
          onClick={() => setSelectedFilter('all_attempted')}
          className={`p-5 rounded-xl border text-left transition-all cursor-pointer ${
            selectedFilter === 'all_attempted'
              ? 'border-blue-500 bg-blue-50/20 dark:bg-blue-950/20 ring-1 ring-blue-500'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <Layers className="h-5 w-5 text-blue-500" />
            <span className="font-extrabold text-xl text-slate-900 dark:text-white">45</span>
          </div>
          <h3 className="font-bold text-slate-900 dark:text-white text-sm">All Attempted Questions</h3>
          <p className="text-xs text-slate-500 mt-1">Full bank revision of every answered case</p>
        </button>
      </div>
    </div>
  );
}

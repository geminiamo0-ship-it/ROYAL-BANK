'use client';

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowRight, CheckSquare, Trophy } from 'lucide-react';

const TOP_CONCEPTS = [
  { id: 1, title: 'Aortic stenosis triad', category: 'Cardiology', frequency: 'Seen in 42 questions' },
  { id: 2, title: 'DKA potassium replacement order', category: 'Endocrinology', frequency: 'Seen in 35 questions' },
  { id: 3, title: 'Nephritic versus nephrotic screening clues', category: 'Nephrology', frequency: 'Seen in 28 questions' },
  { id: 4, title: 'Stroke localisation basics', category: 'Neurology', frequency: 'Seen in 31 questions' },
  { id: 5, title: 'Approach to pulmonary embolism risk tools', category: 'Respiratory Medicine', frequency: 'Seen in 24 questions' },
  { id: 6, title: 'Rheumatology autoantibody pattern recognition', category: 'Rheumatology', frequency: 'Seen in 21 questions' },
];

export default function TopConceptsPage() {
  const params = useParams();
  const bankId = params.bankId || '1';

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-16 text-xs sm:text-sm">
      <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 flex items-center justify-center">
            <Trophy className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">Top 100 Concepts</h1>
            <p className="text-xs text-slate-500">
              The most repeatedly tested ideas in this bank, ranked for fast revision before an exam push.
            </p>
          </div>
        </div>

        <Link
          href={`/bank/${bankId}/question-bank`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-blue-700"
        >
          <span>Practice from bank</span>
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {TOP_CONCEPTS.map((concept, index) => (
          <article
            key={concept.id}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                    Rank #{index + 1}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {concept.category}
                  </span>
                </div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">{concept.title}</h2>
                <p className="text-[11px] text-slate-500">{concept.frequency}</p>
              </div>

              <CheckSquare className="h-5 w-5 shrink-0 text-amber-500" />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

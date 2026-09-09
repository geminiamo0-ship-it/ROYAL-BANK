'use client';

import React from 'react';
import { GraduationCap, CheckCircle2 } from 'lucide-react';

export default function ReviewFactsPage() {
  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-16 text-xs sm:text-sm">
      <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 flex items-center justify-center font-bold">
            <GraduationCap className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">
              Review High-Yield Facts
            </h1>
            <p className="text-xs text-slate-500">
              Curated bullet-point clinical facts for quick pre-exam memory consolidation
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
          <span className="font-bold text-blue-600 dark:text-blue-400 text-xs uppercase tracking-wider">Cardiology Facts</span>
          <ul className="space-y-2 text-slate-700 dark:text-slate-200">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
              <span>Aortic stenosis triad: Angina, Syncope, and Heart failure (Dyspnoea).</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
              <span>WPW Syndrome: Delta wave, short PR interval, and widened QRS complex.</span>
            </li>
          </ul>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
          <span className="font-bold text-blue-600 dark:text-blue-400 text-xs uppercase tracking-wider">Neurology Facts</span>
          <ul className="space-y-2 text-slate-700 dark:text-slate-200">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
              <span>Internuclear ophthalmoplegia (INO): lesion in medial longitudinal fasciculus (MLF).</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
              <span>Guillain-Barré Syndrome: Albuminocytological dissociation in CSF analysis.</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

'use client';

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { BarChart2, ChevronRight } from 'lucide-react';

interface CategoryPerf {
  category: string;
  attempted: number;
  correct: number;
  peerAverage: number;
  totalQuestions: number;
}

const SAMPLE_PERFORMANCE: CategoryPerf[] = [
  { category: 'Cardiology', attempted: 45, correct: 34, peerAverage: 68, totalQuestions: 694 },
  { category: 'Endocrinology', attempted: 30, correct: 24, peerAverage: 72, totalQuestions: 446 },
  { category: 'Gastroenterology', attempted: 28, correct: 18, peerAverage: 65, totalQuestions: 413 },
  { category: 'Infectious Diseases', attempted: 50, correct: 41, peerAverage: 70, totalQuestions: 573 },
  { category: 'Nephrology', attempted: 20, correct: 11, peerAverage: 62, totalQuestions: 275 },
  { category: 'Neurology', attempted: 40, correct: 29, peerAverage: 66, totalQuestions: 554 },
  { category: 'Respiratory Medicine', attempted: 35, correct: 28, peerAverage: 74, totalQuestions: 265 },
  { category: 'Rheumatology', attempted: 25, correct: 19, peerAverage: 69, totalQuestions: 352 },
  { category: 'Clinical Sciences', attempted: 22, correct: 14, peerAverage: 58, totalQuestions: 571 },
];

export default function PerformancePage() {
  const params = useParams();
  const bankId = params.bankId || '1';

  const totalAttempted = SAMPLE_PERFORMANCE.reduce((a, b) => a + b.attempted, 0);
  const totalCorrect = SAMPLE_PERFORMANCE.reduce((a, b) => a + b.correct, 0);
  const overallAccuracy = totalAttempted > 0 ? Math.round((totalCorrect / totalAttempted) * 100) : 0;

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-16 text-xs sm:text-sm">
      <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 flex items-center justify-center font-bold">
            <BarChart2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">
              Clinical Performance & Analytics
            </h1>
            <p className="text-xs text-slate-500">
              Real-time accuracy breakdown and peer benchmark comparison
            </p>
          </div>
        </div>

        <Link
          href={`/bank/${bankId}/question-bank`}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs"
        >
          <span>Practice Weak Topics</span>
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-1">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Overall Accuracy</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-slate-900 dark:text-white">{overallAccuracy}%</span>
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Target: 70%+</span>
          </div>
          <p className="text-[11px] text-slate-500">Peer average is 67%</p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-1">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Questions Answered</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-slate-900 dark:text-white">{totalAttempted}</span>
            <span className="text-xs text-slate-400">/ 5,444</span>
          </div>
          <p className="text-[11px] text-slate-500">5,149 unattempted</p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-1">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Correct vs Incorrect</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-emerald-600">{totalCorrect}</span>
            <span className="text-slate-400">/</span>
            <span className="text-xl font-bold text-red-500">{totalAttempted - totalCorrect}</span>
          </div>
          <p className="text-[11px] text-slate-500">Net score: +{totalCorrect - (totalAttempted - totalCorrect)}</p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-1">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Estimated Percentile</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-blue-600">78th</span>
            <span className="text-xs text-slate-400">Percentile</span>
          </div>
          <p className="text-[11px] text-slate-500">Pass probability: 84%</p>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="p-4 bg-slate-50/70 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider">
            Specialty Accuracy & Benchmark Comparison
          </h2>
          <span className="text-xs text-slate-400">Sorted by accuracy</span>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {SAMPLE_PERFORMANCE.map((item) => {
            const userAcc = Math.round((item.correct / item.attempted) * 100);
            const isAbovePeer = userAcc >= item.peerAverage;

            return (
              <div key={item.category} className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                <div className="w-full sm:w-1/3">
                  <span className="font-bold text-slate-900 dark:text-white block">{item.category}</span>
                  <span className="text-[11px] text-slate-400">
                    {item.attempted} of {item.totalQuestions} questions attempted ({item.correct} correct)
                  </span>
                </div>

                <div className="w-full sm:w-1/2 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-semibold">
                    <span className={userAcc >= 70 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                      Your Score: {userAcc}%
                    </span>
                    <span className="text-slate-400">Peer Average: {item.peerAverage}%</span>
                  </div>

                  <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden relative">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        userAcc >= 70 ? 'bg-emerald-500' : userAcc >= 60 ? 'bg-blue-500' : 'bg-amber-500'
                      }`}
                      style={{ width: `${userAcc}%` }}
                    />
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-slate-900 dark:bg-white"
                      style={{ left: `${item.peerAverage}%` }}
                      title={`Peer average: ${item.peerAverage}%`}
                    />
                  </div>
                </div>

                <div className="shrink-0">
                  <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                    isAbovePeer
                      ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                      : 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
                  }`}>
                    {isAbovePeer ? `+${userAcc - item.peerAverage}% Above` : `${userAcc - item.peerAverage}% Below`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

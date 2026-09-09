'use client';

import React from 'react';
import Link from 'next/link';
import { FileText, Clock, Play, Award, AlertCircle, Layers } from 'lucide-react';

interface MockExam {
  id: number;
  title: string;
  paper: string;
  totalQuestions: number;
  durationMinutes: number;
  difficulty: string;
  isCompleted: boolean;
  score?: number;
  benchmarkScore?: number;
}

const MOCK_EXAMS: MockExam[] = [
  {
    id: 1,
    title: 'MRCP Part 1 — Official Mock Exam 1',
    paper: 'Paper 1 (Clinical Sciences & Core Medicine)',
    totalQuestions: 100,
    durationMinutes: 180,
    difficulty: 'Exam Standard',
    isCompleted: false,
    benchmarkScore: 68,
  },
  {
    id: 2,
    title: 'MRCP Part 1 — Official Mock Exam 2',
    paper: 'Paper 2 (Specialty Medicine & Diagnostics)',
    totalQuestions: 100,
    durationMinutes: 180,
    difficulty: 'Exam Standard',
    isCompleted: false,
    benchmarkScore: 65,
  },
  {
    id: 3,
    title: 'MRCP Part 1 — Comprehensive Gold Standard Mock',
    paper: 'Papers 1 & 2 Combined Simulation',
    totalQuestions: 200,
    durationMinutes: 360,
    difficulty: 'Hard (High-Yield)',
    isCompleted: false,
    benchmarkScore: 63,
  },
];

export default function MockExamsPage() {
  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-16 text-xs sm:text-sm">
      <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 flex items-center justify-center font-bold">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">
              Official Simulation Mock Exams
            </h1>
            <p className="text-xs text-slate-500">
              Full-length timed examinations simulating real Royal College conditions
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
          <Clock className="h-4 w-4 text-purple-600" />
          <span>Strict Exam Timer</span>
        </div>
      </div>

      <div className="p-4 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/80 flex items-start gap-3 text-blue-900 dark:text-blue-200 text-xs">
        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
        <div className="space-y-1">
          <p className="font-bold">How Royal Bank Mock Exams Work:</p>
          <p className="text-slate-600 dark:text-slate-300">
            Answers and peer percentile comparisons will be locked until you complete the entire test paper. You can pause and resume at any time.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {MOCK_EXAMS.map((mock) => (
          <div
            key={mock.id}
            className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-6 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
          >
            <div className="space-y-2 max-w-xl">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300">
                  {mock.paper}
                </span>
                <span className="text-xs font-semibold text-slate-400">
                  {mock.difficulty}
                </span>
              </div>

              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {mock.title}
              </h3>

              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 font-medium pt-1">
                <span className="flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-purple-500" />
                  {mock.totalQuestions} Questions
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-purple-500" />
                  {mock.durationMinutes} Minutes ({mock.durationMinutes / 60} hours)
                </span>
                <span className="flex items-center gap-1.5">
                  <Award className="h-3.5 w-3.5 text-purple-500" />
                  Pass Benchmark: {mock.benchmarkScore}%
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 w-full md:w-auto justify-end">
              <Link
                href={`/exam/mock-${mock.id}`}
                className="w-full md:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition-colors"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Start Mock Exam</span>
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

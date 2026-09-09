'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { Play, Trash2 } from 'lucide-react';
import { deleteSession } from '@/actions/exam';
import { decodeTopicFilter } from '@/lib/topic-filters';
import { formatDate } from '@/lib/utils';

export interface PreviousSession {
  id: string;
  created_at: string;
  categories: string[] | null;
  total_questions: number;
  session_type: string;
  is_completed: boolean;
  score_percentage: number | null;
  answeredCount: number;
}

function formatCategories(categories: string[] | null) {
  if (!categories || categories.length === 0) return 'All Categories';
  if (categories.length > 2) return 'Mixed Categories';

  return categories
    .map((category) => {
      const topicFilter = decodeTopicFilter(category);
      return topicFilter ? `${topicFilter.category} > ${topicFilter.topic}` : category;
    })
    .join(', ');
}

function formatMode(mode: string) {
  if (mode === 'tutor' || mode === 'standard') return 'Tutor';
  if (mode === 'timed' || mode === 'fixed_timed') return 'Timed';
  return mode;
}

export function PreviousSessionsClient({
  sessions,
  bankId,
}: {
  sessions: PreviousSession[];
  bankId: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleDelete = (sessionId: string) => {
    if (!confirm('Delete this incomplete block? Unanswered questions will be released.')) return;

    setError(null);
    startTransition(async () => {
      const result = await deleteSession(sessionId, `/bank/${bankId}/fixed-sets`);
      if (result.error) setError(result.error);
    });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-16 text-[13px]">
      {error ? (
        <div className="rounded-[4px] border border-red-300 bg-red-50 px-3 py-2 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[4px] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-[#fdf2f2] font-semibold text-[#8e4545] dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300">
                <th className="w-[120px] px-4 py-3 text-[11px] uppercase tracking-wider"># ID</th>
                <th className="px-4 py-3 text-[11px] uppercase tracking-wider">NAME</th>
                <th className="w-[80px] px-4 py-3 text-center text-[11px] uppercase tracking-wider">SCORE</th>
                <th className="w-[120px] px-4 py-3 text-center text-[11px] uppercase tracking-wider">CREATED</th>
                <th className="w-[100px] px-4 py-3 text-center text-[11px] uppercase tracking-wider">MODE</th>
                <th className="w-[120px] px-4 py-3 text-center text-[11px] uppercase tracking-wider">QUESTIONS</th>
                <th className="w-[120px] px-4 py-3 text-center text-[11px] uppercase tracking-wider">STATUS</th>
                <th className="w-[100px] px-4 py-3 text-center text-[11px] uppercase tracking-wider">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white text-slate-700 dark:divide-slate-800 dark:bg-slate-900 dark:text-slate-300">
              {sessions.map((session) => (
                <tr key={session.id} className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-4 font-mono text-[12px] text-slate-500 dark:text-slate-400">
                    {session.id.split('-')[0]}
                  </td>
                  <td className="px-4 py-4">
                    <div className="font-medium text-slate-700 dark:text-slate-200">
                      {formatCategories(session.categories)}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-center">
                    {session.score_percentage !== null ? `${Math.round(session.score_percentage)}%` : '-'}
                  </td>
                  <td className="px-4 py-4 text-center text-slate-500 dark:text-slate-400">
                    {formatDate(session.created_at)}
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className="inline-flex items-center rounded-full border border-slate-300 px-3 py-1 text-[11px] font-medium text-slate-600 dark:border-slate-600 dark:text-slate-300">
                      {formatMode(session.session_type)}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-center font-medium">
                    {session.answeredCount} / {session.total_questions}
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className={`inline-flex min-w-[90px] items-center justify-center rounded-full border px-3 py-1 text-[11px] font-medium ${
                      session.is_completed
                        ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-400'
                        : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-400'
                    }`}>
                      {session.is_completed ? 'Completed' : 'Suspended'}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    {session.is_completed ? (
                      <div className="text-center text-[11px] text-slate-400">Read only</div>
                    ) : (
                      <div className="flex items-center justify-center gap-4">
                        <Link
                          href={`/exam/${session.id}`}
                          className="text-blue-600 transition-colors hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                          title="Resume Block"
                        >
                          <Play className="h-4 w-4 fill-current" />
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleDelete(session.id)}
                          disabled={isPending}
                          className="text-red-500 transition-colors hover:text-red-700 disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
                          title="Delete Incomplete Block"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                    No previous blocks found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

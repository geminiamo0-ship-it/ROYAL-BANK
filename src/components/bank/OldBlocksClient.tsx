'use client';

import React, { useTransition } from 'react';
import { Play, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { deleteSession } from '@/actions/exam';

export interface OldBlockSession {
  id: string;
  created_at: string;
  categories: string[] | null;
  total_questions: number;
  session_type: string;
  is_completed: boolean;
  score_percentage: number | null;
  answeredCount: number;
}

export function OldBlocksClient({
  sessions,
  bankId,
}: {
  sessions: OldBlockSession[];
  bankId: number;
}) {
  const [isPending, startTransition] = useTransition();

  const handleDelete = (sessionId: string) => {
    if (!confirm('Are you sure you want to delete this block?')) return;
    startTransition(async () => {
      await deleteSession(sessionId, `/bank/${bankId}/fixed-sets`);
    });
  };

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatCategories = (categories: string[] | null) => {
    if (!categories || categories.length === 0) return 'All Categories';
    if (categories.length > 2) return 'Mixed Categories';
    return categories.map(cat => {
      if (cat.startsWith('__topic__::')) {
        const decoded = decodeURIComponent(cat.replace('__topic__::', ''));
        const parts = decoded.split('::');
        return parts.length === 2 ? `${parts[0]} > ${parts[1]}` : decoded;
      }
      return cat;
    }).join(', ');
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-16 text-[13px]">
      <div className="bg-white dark:bg-slate-900 rounded-[4px] border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-[#fdf2f2] dark:bg-slate-800/50 text-[#8e4545] dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-800">
                <th className="px-4 py-3 uppercase tracking-wider text-[11px] w-[120px]"># ID</th>
                <th className="px-4 py-3 uppercase tracking-wider text-[11px]">NAME</th>
                <th className="px-4 py-3 uppercase tracking-wider text-[11px] text-center w-[80px]">SCORE</th>
                <th className="px-4 py-3 uppercase tracking-wider text-[11px] text-center w-[120px]">CREATED</th>
                <th className="px-4 py-3 uppercase tracking-wider text-[11px] text-center w-[100px]">MODE</th>
                <th className="px-4 py-3 uppercase tracking-wider text-[11px] text-center w-[120px]">QUESTIONS</th>
                <th className="px-4 py-3 uppercase tracking-wider text-[11px] text-center w-[120px]">STATUS</th>
                <th className="px-4 py-3 uppercase tracking-wider text-[11px] text-center w-[100px]">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300">
              {sessions.map((session) => (
                <tr key={session.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-4 text-slate-500 dark:text-slate-400 font-mono text-[12px]">
                    {session.id.split('-')[0]}
                  </td>
                  <td className="px-4 py-4">
                    <div className="text-slate-700 dark:text-slate-200 font-medium">
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
                    <span className="inline-flex items-center px-3 py-1 rounded-full border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-[11px] font-medium">
                      {session.session_type === 'standard' ? 'Tutor' : session.session_type}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-center font-medium">
                    {session.answeredCount} / {session.total_questions}
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className={`inline-flex items-center justify-center min-w-[90px] px-3 py-1 rounded-full border text-[11px] font-medium ${
                      session.is_completed 
                        ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-400' 
                        : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-400'
                    }`}>
                      {session.is_completed ? 'Completed' : 'In Progress'}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center justify-center gap-4">
                      <Link
                        href={`/exam/${session.id}`}
                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                        title="Continue Block"
                      >
                        <Play className="h-4 w-4 fill-current" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDelete(session.id)}
                        disabled={isPending}
                        className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors disabled:opacity-50"
                        title="Delete Block"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {sessions.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                    No previous blocks found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

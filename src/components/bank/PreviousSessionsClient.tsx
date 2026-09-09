'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { Eye, Play, Plus, Trash2 } from 'lucide-react';
import { deleteSession } from '@/actions/exam';
import { decodeTopicFilter } from '@/lib/topic-filters';
import { formatDate } from '@/lib/utils';

export interface PreviousSession {
  id: string;
  started_at: string;
  completed_at: string | null;
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
      const result = await deleteSession(sessionId, `/bank/${bankId}/sessions`);
      if (result.error) setError(result.error);
    });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 pb-16 text-[13px]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold text-white">Previous Sessions</h1>
          <p className="mt-1 text-[11px] text-[#9da8b0]">Resume unfinished blocks or review completed blocks. All rows come from your saved sessions.</p>
        </div>
        <Link href={`/bank/${bankId}/question-bank`} className="inline-flex h-[31px] items-center justify-center gap-2 rounded-[4px] bg-[#d5e4ff] px-4 text-[11px] font-semibold text-[#102148] hover:bg-[#e2ecff]">
          <Plus className="h-3.5 w-3.5" /> Create new session
        </Link>
      </div>

      {error ? (
        <div className="rounded-[4px] border border-red-300 bg-red-50 px-3 py-2 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[4px] border border-[#4a535b] bg-[#343b41] shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[#586169] bg-[#f4ecec] font-semibold text-[#8e4545]">
                <th className="w-[120px] px-4 py-3 text-[11px] uppercase tracking-wider"># ID</th>
                <th className="px-4 py-3 text-[11px] uppercase tracking-wider">Name</th>
                <th className="w-[80px] px-4 py-3 text-center text-[11px] uppercase tracking-wider">Score</th>
                <th className="w-[120px] px-4 py-3 text-center text-[11px] uppercase tracking-wider">Created</th>
                <th className="w-[100px] px-4 py-3 text-center text-[11px] uppercase tracking-wider">Mode</th>
                <th className="w-[120px] px-4 py-3 text-center text-[11px] uppercase tracking-wider">Questions</th>
                <th className="w-[120px] px-4 py-3 text-center text-[11px] uppercase tracking-wider">Status</th>
                <th className="w-[145px] px-4 py-3 text-center text-[11px] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#4b545c] bg-[#31383e] text-[#d8dfe4]">
              {sessions.map((session) => (
                <tr key={session.id} className="transition-colors hover:bg-[#394148]">
                  <td className="px-4 py-4 font-mono text-[12px] text-[#9da8b0]">{session.id.split('-')[0]}</td>
                  <td className="px-4 py-4"><div className="font-medium text-[#edf1f4]">{formatCategories(session.categories)}</div></td>
                  <td className="px-4 py-4 text-center">{session.score_percentage !== null ? `${Math.round(session.score_percentage)}%` : '—'}</td>
                  <td className="px-4 py-4 text-center text-[#aab4bb]">{formatDate(session.started_at)}</td>
                  <td className="px-4 py-4 text-center">
                    <span className="inline-flex items-center rounded-full border border-[#68727a] px-3 py-1 text-[11px] font-medium text-[#d4dce1]">{formatMode(session.session_type)}</span>
                  </td>
                  <td className="px-4 py-4 text-center font-medium">{session.answeredCount} / {session.total_questions}</td>
                  <td className="px-4 py-4 text-center">
                    <span className={`inline-flex min-w-[90px] items-center justify-center rounded-full border px-3 py-1 text-[11px] font-medium ${session.is_completed ? 'border-green-700/60 bg-green-950/30 text-green-300' : 'border-amber-700/60 bg-amber-950/30 text-amber-300'}`}>
                      {session.is_completed ? 'Completed' : 'In progress'}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    {session.is_completed ? (
                      <div className="flex items-center justify-center">
                        <Link href={`/exam/${session.id}?review=1`} className="inline-flex items-center gap-1.5 rounded-[4px] bg-[#d9cef4] px-3 py-1.5 text-[11px] font-semibold text-[#352455] hover:bg-[#e5dcfb]" title="Review completed block">
                          <Eye className="h-3.5 w-3.5" /> Review
                        </Link>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-3">
                        <Link href={`/exam/${session.id}`} className="inline-flex items-center gap-1.5 rounded-[4px] bg-[#d5e4ff] px-3 py-1.5 text-[11px] font-semibold text-[#102148] hover:bg-[#e2ecff]" title="Resume block">
                          <Play className="h-3.5 w-3.5 fill-current" /> Resume
                        </Link>
                        <button type="button" onClick={() => handleDelete(session.id)} disabled={isPending} className="text-red-400 transition-colors hover:text-red-300 disabled:opacity-50" title="Delete incomplete block">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {sessions.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-[#9da8b0]">No previous sessions found.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

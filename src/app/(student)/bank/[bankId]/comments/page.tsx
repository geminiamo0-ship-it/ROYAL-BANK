'use client';

import React from 'react';
import { MessageSquare, Pin, ThumbsUp } from 'lucide-react';

const SAMPLE_THREADS = [
  {
    id: 1,
    title: 'Why is the answer clopidogrel rather than aspirin alone here?',
    category: 'Cardiology',
    replies: 12,
    likes: 24,
    status: 'Active',
    updatedAt: '18 minutes ago',
  },
  {
    id: 2,
    title: 'Can someone explain the DKA potassium replacement timing?',
    category: 'Endocrinology',
    replies: 8,
    likes: 15,
    status: 'Pinned',
    updatedAt: '2 hours ago',
  },
  {
    id: 3,
    title: 'Useful trick for separating nephritic from nephrotic syndromes',
    category: 'Nephrology',
    replies: 6,
    likes: 19,
    status: 'Solved',
    updatedAt: 'Yesterday',
  },
];

export default function CommentThreadsPage() {
  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-16 text-xs sm:text-sm">
      <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-cyan-100 dark:bg-cyan-950/60 text-cyan-700 dark:text-cyan-300 flex items-center justify-center">
            <MessageSquare className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">Comment Threads</h1>
            <p className="text-xs text-slate-500">
              Shared discussion around difficult stems, explanation quality, and high-yield reasoning.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
        {SAMPLE_THREADS.map((thread) => (
          <article key={thread.id} className="p-5 hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {thread.category}
                  </span>
                  <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                    {thread.status}
                  </span>
                </div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">{thread.title}</h2>
                <p className="text-[11px] text-slate-500">Updated {thread.updatedAt}</p>
              </div>

              <div className="flex items-center gap-4 text-[11px] font-semibold text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <MessageSquare className="h-3.5 w-3.5" />
                  {thread.replies} replies
                </span>
                <span className="inline-flex items-center gap-1">
                  <ThumbsUp className="h-3.5 w-3.5" />
                  {thread.likes}
                </span>
                {thread.status === 'Pinned' && (
                  <span className="inline-flex items-center gap-1 text-amber-600">
                    <Pin className="h-3.5 w-3.5" />
                    Pinned
                  </span>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

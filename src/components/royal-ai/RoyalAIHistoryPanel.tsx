'use client';

import { ChevronLeft, Trash2 } from 'lucide-react';

export type RoyalAIConversationSummary = {
  id: string;
  title: string;
  language: 'en' | 'ar';
  messageCount: number;
  createdAtMs: number;
  updatedAtMs: number;
};

export function RoyalAIHistoryPanel({
  conversations,
  onClose,
  onOpen,
  onDelete,
  onDeleteAll,
}: {
  conversations: RoyalAIConversationSummary[];
  onClose: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onDeleteAll: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 bg-[#f8f4eb] dark:bg-[#10171c] sm:left-auto sm:w-[420px] sm:border-l sm:border-black/8 sm:shadow-2xl dark:sm:border-white/8">
      <div className="flex h-[66px] items-center justify-between border-b border-black/8 px-4 dark:border-white/8">
        <button onClick={onClose} className="inline-flex items-center gap-1 text-[11px] font-semibold">
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <span className="font-serif text-[17px] font-semibold">History</span>
        <button onClick={onDeleteAll} className="grid h-9 w-9 place-items-center rounded-full text-red-500 hover:bg-red-500/8" title="Delete all">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-2 overflow-y-auto p-4">
        {conversations.length === 0 ? (
          <p className="py-12 text-center text-[11px] text-[#8a8175] dark:text-white/35">No conversations yet.</p>
        ) : conversations.map((item) => (
          <div key={item.id} className="group flex items-center gap-2 rounded-xl border border-black/8 bg-[#fffdf8] p-3 dark:border-white/8 dark:bg-[#151d23]">
            <button onClick={() => onOpen(item.id)} className="min-w-0 flex-1 text-left">
              <p className="truncate text-[11px] font-semibold">{item.title}</p>
              <p className="mt-1 text-[9px] text-[#91887d] dark:text-white/32">{new Date(item.updatedAtMs).toLocaleString()}</p>
            </button>
            <button onClick={() => onDelete(item.id)} className="grid h-8 w-8 place-items-center rounded-full text-[#9c9184] opacity-70 hover:bg-red-500/8 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100" aria-label="Delete conversation">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

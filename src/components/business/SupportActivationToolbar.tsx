'use client';

import { RefreshCw, Search, X } from 'lucide-react';

export type QueueFilter = 'pending' | 'paid' | 'activated' | 'cancelled' | 'all';

const FILTERS: Array<{ value: QueueFilter; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'paid', label: 'Paid' },
  { value: 'activated', label: 'Activated' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All' },
];

interface Props {
  status: QueueFilter;
  search: string;
  searchDraft: string;
  onSearchDraftChange: (value: string) => void;
  onSearchSubmit: (value: string) => void;
  onClearSearch: () => void;
  onRefresh: () => void;
  onStatusChange: (value: QueueFilter) => void;
}

export function SupportActivationToolbar({
  status,
  search,
  searchDraft,
  onSearchDraftChange,
  onSearchSubmit,
  onClearSearch,
  onRefresh,
  onStatusChange,
}: Props) {
  return (
    <>
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-purple-400">Operations</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-white">Support Activation</h1>
          <p className="mt-1 text-sm font-medium text-slate-400">Record the sale, manually verify payment, then manually activate or extend access.</p>
        </div>

        <div className="flex w-full max-w-2xl gap-2">
          <form
            className="flex min-w-0 flex-1 gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              onSearchSubmit(searchDraft.trim());
            }}
          >
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                value={searchDraft}
                onChange={(event) => onSearchDraftChange(event.target.value)}
                placeholder="Search request ID, email, or name..."
                className="h-11 w-full rounded-xl border border-slate-700 bg-[#0b1627] pl-10 pr-10 text-sm font-medium text-white outline-none placeholder:text-slate-500 focus:border-purple-500"
              />
              {searchDraft && (
                <button
                  type="button"
                  onClick={onClearSearch}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <button type="submit" className="rounded-xl bg-purple-600 px-5 text-xs font-black text-white hover:bg-purple-500">Search</button>
          </form>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-700 bg-[#0b1627] px-4 text-xs font-bold text-slate-200 hover:border-slate-500"
          >
            <RefreshCw className="h-4 w-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onStatusChange(option.value)}
            className={`rounded-full border px-4 py-2 text-xs font-black transition ${
              status === option.value && !search
                ? 'border-purple-400 bg-purple-600 text-white'
                : 'border-slate-700 bg-[#0b1627] text-slate-300 hover:border-slate-500 hover:text-white'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </>
  );
}

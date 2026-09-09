import { ChevronRight } from 'lucide-react';
import { StatusBadge, formatDate } from '@/components/business/SupportActivationParts';
import type { SupportUpgradeQueueItem } from '@/types/business';

export function SupportRequestQueue({
  items,
  selectedId,
  queueError,
  onOpen,
}: {
  items: SupportUpgradeQueueItem[];
  selectedId?: string;
  queueError: string | null;
  onOpen: (requestId: string) => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0b1627] shadow-2xl shadow-black/20">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-4">
        <h2 className="text-sm font-black text-white">Requests</h2>
        <span className="text-xs font-bold text-slate-500">{items.length}</span>
      </div>
      <div className="max-h-[760px] space-y-2 overflow-y-auto p-2">
        {items.length === 0 && !queueError ? (
          <div className="p-8 text-center text-sm font-medium text-slate-500">No matching requests.</div>
        ) : (
          items.map((item) => (
            <button
              key={item.request_id}
              type="button"
              onClick={() => onOpen(item.request_id)}
              className={`w-full rounded-xl border p-3.5 text-left transition ${
                selectedId === item.request_id
                  ? 'border-purple-500 bg-purple-500/10'
                  : 'border-transparent bg-[#0e1a2d] hover:border-slate-700 hover:bg-[#111f34]'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs font-black text-purple-400">{item.public_code}</p>
                  <p className="mt-1 truncate text-sm font-bold text-white">{item.full_name || item.email}</p>
                  <p className="mt-0.5 truncate text-xs font-medium text-slate-400">{item.email}</p>
                </div>
                <StatusBadge status={item.request_status} />
              </div>
              <div className="mt-3 flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-slate-200">{item.product_name}</p>
                  <p className="mt-1 text-[10px] font-medium text-slate-500">{formatDate(item.created_at)}</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-600" />
              </div>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

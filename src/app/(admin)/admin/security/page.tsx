'use client';

import React, { useState } from 'react';
import { Ban, Plus } from 'lucide-react';

interface BlockedIp {
  id: number;
  ip: string;
  reason: string;
  blockedAt: string;
}

const INITIAL_BLOCKED: BlockedIp[] = [
  { id: 1, ip: '102.189.45.12', reason: 'Account sharing (7 devices across 3 cities)', blockedAt: '2026-08-24' },
  { id: 2, ip: '196.221.78.90', reason: 'Repeated scraping attempt on question endpoints', blockedAt: '2026-08-22' },
];

export default function AdminSecurityPage() {
  const [blockedIps, setBlockedIps] = useState<BlockedIp[]>(INITIAL_BLOCKED);
  const [newIp, setNewIp] = useState('');
  const [newReason, setNewReason] = useState('');

  const handleAddBlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIp.trim()) return;

    setBlockedIps([
      {
        id: Date.now(),
        ip: newIp.trim(),
        reason: newReason.trim() || 'Manual admin block',
        blockedAt: new Date().toISOString().split('T')[0],
      },
      ...blockedIps,
    ]);

    setNewIp('');
    setNewReason('');
  };

  const handleUnblock = (id: number) => {
    setBlockedIps(blockedIps.filter((item) => item.id !== id));
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-16 text-xs sm:text-sm">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">
          Security & IP Protection
        </h1>
        <p className="text-xs text-slate-500">
          Enforce single-user account policies, device fingerprint limits, and firewall IP blocking
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
          <h2 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
            <Ban className="h-4 w-4 text-red-600" />
            <span>Block IP Address</span>
          </h2>

          <form onSubmit={handleAddBlock} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                IP Address
              </label>
              <input
                type="text"
                value={newIp}
                onChange={(e) => setNewIp(e.target.value)}
                placeholder="197.34.12.89"
                required
                className="w-full p-2.5 text-xs font-mono border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Reason for Block
              </label>
              <input
                type="text"
                value={newReason}
                onChange={(e) => setNewReason(e.target.value)}
                placeholder="Account sharing, abusive scraping..."
                className="w-full p-2.5 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>

            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-xs shadow-sm transition-all"
            >
              <Plus className="h-4 w-4" />
              <span>Add to Blocklist</span>
            </button>
          </form>
        </div>

        <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <span className="font-bold text-slate-900 dark:text-white text-sm">
              Active IP Blocklist ({blockedIps.length})
            </span>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {blockedIps.map((b) => (
              <div key={b.id} className="p-4 flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 font-mono text-xs font-bold text-red-600 dark:text-red-400">
                    <Ban className="h-3.5 w-3.5" />
                    <span>{b.ip}</span>
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-300">{b.reason}</p>
                  <span className="text-[11px] text-slate-400">Blocked on {b.blockedAt}</span>
                </div>

                <button
                  onClick={() => handleUnblock(b.id)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold"
                >
                  Unblock
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

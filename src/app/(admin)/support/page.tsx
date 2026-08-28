'use client';

import React, { useState } from 'react';
import { 
  Search, 
  ShieldCheck, 
  UserCheck, 
  Check, 
  Clock, 
  Lock, 
  Calendar,
  AlertCircle
} from 'lucide-react';

interface MockUser {
  id: string;
  email: string;
  fullName: string;
  tier: 'free_trial' | 'premium_individual' | 'premium_full';
  pathways: string[];
  registeredAt: string;
  lastLoginIp: string;
}

const MOCK_USERS_DATA: MockUser[] = [
  {
    id: 'usr-1',
    email: 'ahmed.mansour@gmail.com',
    fullName: 'Dr. Ahmed Mansour',
    tier: 'free_trial',
    pathways: ['MRCP Part 1 (Free Trial)'],
    registeredAt: '2026-08-25',
    lastLoginIp: '197.34.12.89',
  },
  {
    id: 'usr-2',
    email: 'sarah.khalil@yahoo.com',
    fullName: 'Dr. Sarah Khalil',
    tier: 'premium_individual',
    pathways: ['MRCP Part 1'],
    registeredAt: '2026-08-20',
    lastLoginIp: '156.204.11.45',
  },
];

export default function SupportDeskPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState<MockUser[]>(MOCK_USERS_DATA);
  const [selectedUser, setSelectedUser] = useState<MockUser | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<'individual' | 'full'>('individual');
  const [durationMonths, setDurationMonths] = useState<number>(3);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setSelectedUser(null);
      return;
    }
    const found = users.find(
      (u) =>
        u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.fullName.toLowerCase().includes(searchQuery.toLowerCase())
    );
    setSelectedUser(found || null);
  };

  const handleActivate = () => {
    if (!selectedUser) return;

    const newTier: 'free_trial' | 'premium_individual' | 'premium_full' =
      selectedPlan === 'full' ? 'premium_full' : 'premium_individual';
    const updated = users.map((u) =>
      u.id === selectedUser.id ? { ...u, tier: newTier } : u
    );

    setUsers(updated);
    setSelectedUser({ ...selectedUser, tier: newTier });
    setSuccessMsg(
      `Successfully upgraded ${selectedUser.fullName} (${selectedUser.email}) to ${
        selectedPlan === 'full' ? 'Full Access' : 'MRCP Part 1 Premium'
      } for ${durationMonths} months!`
    );

    setTimeout(() => setSuccessMsg(null), 5000);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-16 text-xs sm:text-sm">
      {/* Top Header */}
      <div className="bg-purple-950 text-white rounded-xl p-6 shadow-md border border-purple-900 flex items-center justify-between">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-purple-800/60 text-purple-200 text-xs font-semibold">
            <ShieldCheck className="h-3.5 w-3.5" />
            Support Desk Console
          </div>
          <h1 className="text-xl font-bold">Fast Subscription Activation</h1>
          <p className="text-purple-300 text-xs">
            Search customer by email received on Telegram to instantly activate subscriptions.
          </p>
        </div>
      </div>

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 flex items-center gap-3">
          <Check className="h-5 w-5 text-emerald-600 shrink-0" />
          <span className="font-semibold">{successMsg}</span>
        </div>
      )}

      {/* Search Box */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <h2 className="font-bold text-slate-900 dark:text-white text-sm">
          Search Registered Student
        </h2>

        <form onSubmit={handleSearch} className="flex gap-3">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-3.5 top-3 text-slate-400" />
            <input
              type="email"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Paste student email (e.g. ahmed.mansour@gmail.com)..."
              required
              className="w-full pl-10 pr-4 py-2.5 text-xs sm:text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <button
            type="submit"
            className="px-5 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs sm:text-sm shadow-sm transition-all cursor-pointer"
          >
            Find Account
          </button>
        </form>
      </div>

      {/* User Lookup Result & Activation Panel */}
      {selectedUser ? (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-6 animate-in fade-in duration-200">
          <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {selectedUser.fullName}
              </h3>
              <p className="text-xs text-slate-500">{selectedUser.email}</p>
            </div>

            <span
              className={`px-3 py-1 rounded-full text-xs font-bold ${
                selectedUser.tier === 'free_trial'
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
              }`}
            >
              {selectedUser.tier === 'free_trial' ? 'Free Trial' : 'Premium Active'}
            </span>
          </div>

          {/* Activation Form */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Subscription Plan
              </label>
              <select
                value={selectedPlan}
                onChange={(e) => setSelectedPlan(e.target.value as 'individual' | 'full')}
                className="w-full p-2.5 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
              >
                <option value="individual">MRCP Part 1 Only (Individual Pathway)</option>
                <option value="full">Royal Bank Full Access (All Pathways)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Duration
              </label>
              <select
                value={durationMonths}
                onChange={(e) => setDurationMonths(parseInt(e.target.value, 10))}
                className="w-full p-2.5 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
              >
                <option value={1}>1 Month</option>
                <option value={3}>3 Months</option>
                <option value={6}>6 Months</option>
                <option value={12}>12 Months (1 Year)</option>
                <option value={999}>Lifetime Access</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={handleActivate}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs sm:text-sm shadow-md shadow-emerald-500/20 transition-all cursor-pointer"
            >
              <UserCheck className="h-4 w-4" />
              <span>Confirm & Activate Premium</span>
            </button>
          </div>
        </div>
      ) : searchQuery ? (
        <div className="bg-white dark:bg-slate-900 p-8 rounded-xl border border-slate-200 dark:border-slate-800 text-center text-slate-500 space-y-2">
          <AlertCircle className="h-7 w-7 mx-auto text-amber-500" />
          <p className="font-semibold text-slate-800 dark:text-slate-200">No account found with this email</p>
          <p className="text-xs">Ask the student to register first on Royal Bank.</p>
        </div>
      ) : null}
    </div>
  );
}

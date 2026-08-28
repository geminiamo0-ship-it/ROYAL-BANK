'use client';

import React, { useState } from 'react';
import { 
  Users, 
  Search, 
  ShieldAlert, 
  UserCheck, 
  Ban, 
  MoreVertical, 
  Check, 
  Filter
} from 'lucide-react';

interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: 'student' | 'admin' | 'support';
  tier: 'free_trial' | 'premium_individual' | 'premium_full';
  status: 'active' | 'suspended';
  lastIp: string;
  deviceCount: number;
  registeredAt: string;
}

const INITIAL_USERS: UserRecord[] = [
  {
    id: 'u1',
    name: 'Dr. Ahmed Mansour',
    email: 'ahmed.mansour@gmail.com',
    role: 'student',
    tier: 'free_trial',
    status: 'active',
    lastIp: '197.34.12.89',
    deviceCount: 1,
    registeredAt: '2026-08-25',
  },
  {
    id: 'u2',
    name: 'Dr. Sarah Khalil',
    email: 'sarah.khalil@yahoo.com',
    role: 'student',
    tier: 'premium_individual',
    status: 'active',
    lastIp: '156.204.11.45',
    deviceCount: 2,
    registeredAt: '2026-08-20',
  },
  {
    id: 'u3',
    name: 'Dr. Mahmoud Elsayed',
    email: 'mahmoud.elsayed@gmail.com',
    role: 'student',
    tier: 'premium_full',
    status: 'suspended',
    lastIp: '41.233.10.12',
    deviceCount: 4,
    registeredAt: '2026-08-15',
  },
];

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRecord[]>(INITIAL_USERS);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('all');

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.lastIp.includes(search);
    const matchesTier = tierFilter === 'all' || u.tier === tierFilter;
    return matchesSearch && matchesTier;
  });

  const toggleUserStatus = (id: string) => {
    setUsers(
      users.map((u) =>
        u.id === id
          ? { ...u, status: u.status === 'active' ? 'suspended' : 'active' }
          : u
      )
    );
  };

  const promoteUser = (id: string, newTier: 'premium_individual' | 'premium_full') => {
    setUsers(
      users.map((u) => (u.id === id ? { ...u, tier: newTier } : u))
    );
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16 text-xs sm:text-sm">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            User Accounts & Subscriptions
          </h1>
          <p className="text-xs text-slate-500">
            Monitor student registrations, active devices, and manage account privileges
          </p>
        </div>

        {/* Search & Filter */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, or IP..."
              className="pl-9 pr-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white w-64 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value)}
            className="p-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
          >
            <option value="all">All Tiers</option>
            <option value="free_trial">Free Trial</option>
            <option value="premium_individual">Individual</option>
            <option value="premium_full">Full Access</option>
          </select>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Student</th>
                <th className="py-3 px-4">Subscription</th>
                <th className="py-3 px-4">Last IP & Devices</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Joined</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className="py-3 px-4">
                    <p className="font-semibold text-slate-900 dark:text-white">{user.name}</p>
                    <p className="text-slate-500 text-xs">{user.email}</p>
                  </td>

                  <td className="py-3 px-4">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                        user.tier === 'free_trial'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          : user.tier === 'premium_individual'
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                          : 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                      }`}
                    >
                      {user.tier === 'free_trial'
                        ? 'Free Trial'
                        : user.tier === 'premium_individual'
                        ? 'MRCP 1 Only'
                        : 'Full Access'}
                    </span>
                  </td>

                  <td className="py-3 px-4">
                    <p className="font-mono text-xs text-slate-700 dark:text-slate-300">{user.lastIp}</p>
                    <span className={`text-[11px] ${user.deviceCount > 2 ? 'text-red-500 font-bold' : 'text-slate-400'}`}>
                      {user.deviceCount} device(s)
                    </span>
                  </td>

                  <td className="py-3 px-4">
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                        user.status === 'active'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                      }`}
                    >
                      {user.status}
                    </span>
                  </td>

                  <td className="py-3 px-4 text-slate-500 text-xs">{user.registeredAt}</td>

                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {user.tier === 'free_trial' && (
                        <button
                          onClick={() => promoteUser(user.id, 'premium_individual')}
                          className="px-2.5 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300 text-xs font-semibold"
                          title="Upgrade to Premium"
                        >
                          Upgrade
                        </button>
                      )}

                      <button
                        onClick={() => toggleUserStatus(user.id)}
                        className={`p-1.5 rounded text-xs font-semibold ${
                          user.status === 'active'
                            ? 'text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950'
                            : 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950'
                        }`}
                        title={user.status === 'active' ? 'Suspend Account' : 'Reactivate Account'}
                      >
                        <Ban className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

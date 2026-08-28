'use client';

import React from 'react';
import { 
  Users, 
  CreditCard, 
  Layers, 
  ShieldAlert, 
  TrendingUp, 
  Clock, 
  CheckCircle2, 
  AlertTriangle 
} from 'lucide-react';

export default function AdminOverviewPage() {
  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16 text-xs sm:text-sm">
      {/* Overview Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">
          Platform Overview & Telemetry
        </h1>
        <p className="text-xs text-slate-500">
          Real-time metrics, active user sessions, and question bank analytics
        </p>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-semibold">Total Students</span>
            <Users className="h-4 w-4 text-blue-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">1,248</p>
          <span className="text-[11px] text-emerald-600 font-medium flex items-center gap-1">
            <TrendingUp className="h-3 w-3" /> +18 new today
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-semibold">Active Subscriptions</span>
            <CreditCard className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">412</p>
          <span className="text-[11px] text-slate-400">33% conversion rate</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-semibold">Total Verified Questions</span>
            <Layers className="h-4 w-4 text-purple-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">5,444</p>
          <span className="text-[11px] text-slate-400">17 Medical Categories</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-semibold">Suspicious Activity</span>
            <ShieldAlert className="h-4 w-4 text-amber-500" />
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">2</p>
          <span className="text-[11px] text-amber-600 font-medium">Multi-IP logins detected</span>
        </div>
      </div>

      {/* Recent Activity Table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <span className="font-bold text-slate-900 dark:text-white text-sm">
            Live Student Activity Log
          </span>
          <span className="text-xs text-slate-400">Updated just now</span>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 flex items-center justify-center font-bold text-xs">
                A
              </div>
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">
                  Dr. Ahmed Mansour
                </p>
                <p className="text-[11px] text-slate-400">
                  Completed Cardiology Quick Practice (10/10) • IP: 197.34.12.89
                </p>
              </div>
            </div>
            <span className="text-[11px] text-slate-400">2 mins ago</span>
          </div>

          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-700 flex items-center justify-center font-bold text-xs">
                S
              </div>
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">
                  Dr. Sarah Khalil
                </p>
                <p className="text-[11px] text-slate-400">
                  Saved concept: &quot;Wilson&apos;s disease caeruloplasmin&quot; • IP: 156.204.11.45
                </p>
              </div>
            </div>
            <span className="text-[11px] text-slate-400">15 mins ago</span>
          </div>
        </div>
      </div>
    </div>
  );
}

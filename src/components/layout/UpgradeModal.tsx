'use client';

import React from 'react';
import { useUIStore } from '@/stores/uiStore';
import { Lock, Send, ShieldCheck, CheckCircle, X } from 'lucide-react';

export function UpgradeModal() {
  const { isUpgradeModalOpen, closeUpgradeModal } = useUIStore();

  if (!isUpgradeModalOpen) return null;

  const telegramUrl = process.env.NEXT_PUBLIC_TELEGRAM_SUPPORT_URL || 'https://t.me/RoyalBankSupport';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-white dark:bg-slate-900 p-6 sm:p-8 shadow-2xl ring-1 ring-slate-200 dark:ring-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={closeUpgradeModal}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="h-12 w-12 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
            <Lock className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white">
              Upgrade to Premium
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Unlock complete question banks, mock exams & high-yield textbook
            </p>
          </div>
        </div>

        <div className="space-y-4 mb-6">
          <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 space-y-2.5">
            <div className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300">
              <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              <span><strong>5,400+ Verified Questions</strong> with complete clinical explanations</span>
            </div>
            <div className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300">
              <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              <span><strong>Full Textbook Library (650+ articles)</strong> integrated per question</span>
            </div>
            <div className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300">
              <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              <span><strong>Timed Mock Exams & Category Heatmaps</strong> for targeted score optimization</span>
            </div>
            <div className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300">
              <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              <span><strong>All Medical Pathways:</strong> MRCP Part 1, MRCOG, MRCS, and more</span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900 flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-blue-600 shrink-0" />
            <p className="text-xs text-blue-900 dark:text-blue-200">
              Send your registered email address on Telegram, and our support team will activate your subscription immediately.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <a
            href={telegramUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 py-3 px-5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm shadow-md shadow-blue-500/20 transition-all"
          >
            <Send className="h-4 w-4" />
            Contact Support on Telegram
          </a>
          <button
            onClick={closeUpgradeModal}
            className="py-3 px-5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            Maybe Later
          </button>
        </div>
      </div>
    </div>
  );
}

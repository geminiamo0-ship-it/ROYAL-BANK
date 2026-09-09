'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUIStore } from '@/stores/uiStore';
import { BarChart2, BookOpen, Clock, Home, Layers, Lightbulb, Map, RotateCcw } from 'lucide-react';

export function PassMedicineSidebar() {
  const pathname = usePathname();
  const { isSidebarOpen } = useUIStore();
  const bankMatch = pathname.match(/\/bank\/(\d+)/);
  const currentBankId = bankMatch ? Number(bankMatch[1]) : null;

  if (!isSidebarOpen || currentBankId === null) return null;

  const bankBase = `/bank/${currentBankId}`;
  const isActive = (href: string, exact = false) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const navClass = (href: string, exact = false) =>
    `flex items-center gap-2 rounded px-2 py-[7px] text-[12px] transition-colors ${
      isActive(href, exact) ? 'bg-[#3b5368] text-white' : 'text-[#dce4e9] hover:bg-[#3b5368] hover:text-white'
    }`;

  return (
    <aside className="min-h-screen w-[200px] shrink-0 bg-[#31485b] text-white">
      <div className="flex h-[72px] items-center px-[17px]">
        <Link href="/dashboard" className="flex items-center gap-3">
          <span className="flex h-[24px] items-end gap-[3px]"><span className="h-[14px] w-[5px] bg-[#ff2020]" /><span className="h-[18px] w-[5px] bg-[#fff100]" /><span className="h-[23px] w-[5px] bg-[#47d41f]" /></span>
          <span className="text-[19px] font-semibold tracking-[-0.3px]">RoyalBank</span>
        </Link>
      </div>

      <Link href="/dashboard" className="block border-y border-[#233545] bg-[#344d61] px-4 py-3 text-[12px] font-semibold text-[#dce4e9] hover:bg-[#3a566d]">All live resources</Link>

      <nav className="px-2 py-4">
        <div className="space-y-1.5">
          <Link href={bankBase} className={navClass(bankBase, true)}><Home className="h-[13px] w-[13px]" /><span>Home</span></Link>
          <Link href={`${bankBase}/question-bank`} className={navClass(`${bankBase}/question-bank`)}><Layers className="h-[13px] w-[13px]" /><span>Question Bank</span></Link>
          <Link href={`${bankBase}/content-map`} className={navClass(`${bankBase}/content-map`)}><Map className="h-[13px] w-[13px]" /><span>Content Map</span></Link>
          <Link href={`${bankBase}/fixed-sets`} className={navClass(`${bankBase}/fixed-sets`)}><Clock className="h-[13px] w-[13px]" /><span>Previous Sessions</span></Link>
          <Link href={`${bankBase}/review`} className={navClass(`${bankBase}/review`)}><RotateCcw className="h-[13px] w-[13px]" /><span>Review Questions</span></Link>
          <Link href={`${bankBase}/performance`} className={navClass(`${bankBase}/performance`)}><BarChart2 className="h-[13px] w-[13px]" /><span>Performance</span></Link>
          <Link href={`${bankBase}/textbook/high-yield`} className={navClass(`${bankBase}/textbook/high-yield`)}><BookOpen className="h-[13px] w-[13px]" /><span>Textbook</span></Link>
          <Link href={`${bankBase}/saved-concepts`} className={navClass(`${bankBase}/saved-concepts`)}><Lightbulb className="h-[13px] w-[13px]" /><span>Saved Concepts</span></Link>
        </div>
      </nav>
    </aside>
  );
}

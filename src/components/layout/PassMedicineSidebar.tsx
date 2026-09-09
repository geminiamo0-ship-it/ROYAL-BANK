'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUIStore } from '@/stores/uiStore';
import { BookOpen, History, Home, Layers, Library, RotateCcw } from 'lucide-react';

interface SidebarProps {
  currentPathwayName?: string;
}

export function PassMedicineSidebar({ currentPathwayName }: SidebarProps) {
  const pathname = usePathname();
  const { isSidebarOpen } = useUIStore();
  const bankMatch = pathname.match(/\/bank\/(\d+)/);
  const currentBankId = bankMatch ? parseInt(bankMatch[1], 10) : null;

  if (!isSidebarOpen || currentBankId === null) return null;

  const bankBase = `/bank/${currentBankId}`;
  const questionBankBase = `${bankBase}/question-bank`;
  const isActive = (href: string, exact = false) => exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const navClass = (href: string, exact = false) => `flex items-center gap-2 px-2 py-[6px] text-[12px] transition-colors ${isActive(href, exact) ? 'bg-[#3b5368] text-white' : 'text-white hover:bg-[#3b5368]'}`;

  return (
    <aside className="min-h-screen w-[200px] shrink-0 bg-[#31485b] text-white">
      <div className="flex h-[92px] items-center px-[17px]">
        <Link href="/dashboard" className="flex items-center gap-3">
          <span className="flex h-[24px] items-end gap-[3px]"><span className="h-[14px] w-[5px] bg-[#ff2020]" /><span className="h-[18px] w-[5px] bg-[#fff100]" /><span className="h-[23px] w-[5px] bg-[#47d41f]" /></span>
          <span className="text-[19px] font-semibold tracking-[-0.3px]">RoyalBank</span>
        </Link>
      </div>

      <Link href="/dashboard" className="block border-y border-[#233545] bg-[#344d61] px-3 py-3 text-[#d7e0e6] hover:bg-[#3a566d]">
        <span className="block text-[10px] uppercase tracking-wide text-[#a8b8c4]">Pathway</span>
        <span className="mt-1 block truncate text-[14px] font-medium">{currentPathwayName || 'Royal resources'}</span>
      </Link>

      <nav className="px-2 py-4">
        <div className="space-y-[7px]">
          <Link href={bankBase} className={navClass(bankBase, true)}><Home className="h-[13px] w-[13px]" /><span>Home</span></Link>
        </div>

        <SidebarSection title="Questions">
          <Link href={questionBankBase} className={navClass(questionBankBase)}><Layers className="h-[13px] w-[13px]" /><span>Question bank</span></Link>
          <Link href={`${bankBase}/sessions`} className={navClass(`${bankBase}/sessions`)}><History className="h-[13px] w-[13px]" /><span>Previous sessions</span></Link>
          <Link href={`${bankBase}/review`} className={navClass(`${bankBase}/review`)}><RotateCcw className="h-[13px] w-[13px]" /><span>Review questions</span></Link>
        </SidebarSection>

        <SidebarSection title="Library">
          <Link href={`${bankBase}/textbook/high-yield`} className={navClass(`${bankBase}/textbook/high-yield`)}><BookOpen className="h-[13px] w-[13px]" /><span>High-yield textbook</span></Link>
          <Link href={`${bankBase}/textbook/extended`} className={navClass(`${bankBase}/textbook/extended`)}><Library className="h-[13px] w-[13px]" /><span>Extended textbook</span></Link>
        </SidebarSection>
      </nav>
    </aside>
  );
}

function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="mt-5"><div className="mb-2 text-[10px] font-medium uppercase tracking-[0.4px] text-[#a8b8c4]">{title}</div><div className="space-y-[7px]">{children}</div></div>;
}

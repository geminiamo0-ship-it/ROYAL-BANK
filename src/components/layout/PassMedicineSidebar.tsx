'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUIStore } from '@/stores/uiStore';
import {
  BarChart2,
  BookOpen,
  CheckSquare,
  ChevronDown,
  Clock,
  FileText,
  GraduationCap,
  Home,
  Layers,
  Library,
  Lightbulb,
  List,
  Map,
  MessageSquare,
  RotateCcw,
  Wand2,
  Zap,
} from 'lucide-react';

interface SidebarProps {
  currentPathwayName?: string;
}

export function PassMedicineSidebar({ currentPathwayName = 'MRCP Part 1' }: SidebarProps) {
  const pathname = usePathname();
  const { isSidebarOpen } = useUIStore();

  const bankMatch = pathname.match(/\/bank\/(\d+)/);
  const currentBankId = bankMatch ? parseInt(bankMatch[1], 10) : 1;

  const bankNames: Record<number, { pathway: string; bank: string; slug: string }> = {
    1: { pathway: currentPathwayName, bank: 'PassMedicine Edition', slug: 'mrcp-part-1' },
    2: { pathway: currentPathwayName, bank: 'Pastest Edition', slug: 'mrcp-part-1' },
    3: { pathway: currentPathwayName, bank: '1Exam / BMJ Edition', slug: 'mrcp-part-1' },
    4: { pathway: 'MRCOG Part 1', bank: 'O&G Core Bank', slug: 'mrcog-part-1' },
    5: { pathway: 'MRCS Part A', bank: 'Surgical Principles Bank', slug: 'mrcs-part-a' },
    6: { pathway: 'PLAB 1 / UKMLA', bank: 'Clinical Practice Bank', slug: 'plab-ukmla' },
  };

  const activeInfo = bankNames[currentBankId] || bankNames[1];
  const bankBase = `/bank/${currentBankId}`;
  const questionBankBase = `${bankBase}/question-bank`;

  const isActive = (href: string, exact = false) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  const navClass = (href: string, exact = false) =>
    `flex items-center gap-2 px-2 py-[6px] text-[12px] transition-colors ${
      isActive(href, exact) ? 'text-white' : 'text-white hover:bg-[#3b5368]'
    }`;

  if (!isSidebarOpen) {
    return null;
  }

  return (
    <aside className="min-h-screen w-[200px] shrink-0 bg-[#31485b] text-white">
      <div className="flex h-[92px] items-center px-[17px]">
        <Link href="/dashboard" className="flex items-center gap-3">
          <span className="flex h-[24px] items-end gap-[3px]">
            <span className="h-[14px] w-[5px] bg-[#ff2020]" />
            <span className="h-[18px] w-[5px] bg-[#fff100]" />
            <span className="h-[23px] w-[5px] bg-[#47d41f]" />
          </span>
          <span className="text-[19px] font-semibold tracking-[-0.3px]">RoyalBank</span>
        </Link>
      </div>

      <Link
        href={`/pathway/${activeInfo.slug}`}
        className="flex h-[49px] items-center justify-between border-y border-[#233545] bg-[#344d61] px-2 text-[#b7c3cc] hover:bg-[#3a566d]"
      >
        <span className="text-[16px] font-medium">{activeInfo.pathway}</span>
        <ChevronDown className="h-4 w-4 text-[#aab6bf]" />
      </Link>

      <nav className="px-2 py-4">
        <div className="space-y-[7px]">
          <Link href={bankBase} className={navClass(bankBase, true)}>
            <Home className="h-[13px] w-[13px]" />
            <span>Home</span>
          </Link>
          <Link href={`${bankBase}/content-map`} className={navClass(`${bankBase}/content-map`)}>
            <Map className="h-[13px] w-[13px]" />
            <span>MRCP 1 Content Map</span>
            <span className="-ml-1 align-top text-[8px] font-bold text-[#ffcf32]">BETA</span>
          </Link>
        </div>

        <SidebarSection title="Questions">
          <Link href={questionBankBase} className={navClass(questionBankBase)}>
            <Layers className="h-[13px] w-[13px]" />
            <span>Question bank</span>
          </Link>
          <Link href={`${bankBase}/fixed-sets`} className={navClass(`${bankBase}/fixed-sets`)}>
            <Clock className="h-[13px] w-[13px]" />
            <span>Old blocks</span>
          </Link>
          <Link href={`${bankBase}/mock-exams`} className={navClass(`${bankBase}/mock-exams`)}>
            <FileText className="h-[13px] w-[13px]" />
            <span>Mock exams</span>
          </Link>
          <Link href={`${bankBase}/review`} className={navClass(`${bankBase}/review`)}>
            <RotateCcw className="h-[13px] w-[13px]" />
            <span>Review questions</span>
          </Link>
          <Link href={`${bankBase}/performance`} className={navClass(`${bankBase}/performance`)}>
            <BarChart2 className="h-[13px] w-[13px]" />
            <span>Performance</span>
            <ChevronDown className="ml-auto h-3 w-3" />
          </Link>
          <Link href={`${bankBase}/comments`} className={navClass(`${bankBase}/comments`)}>
            <MessageSquare className="h-[13px] w-[13px]" />
            <span>Comment threads</span>
          </Link>
        </SidebarSection>

        <SidebarSection title="Textbooks">
          <Link href={`${bankBase}/textbook/high-yield`} className={navClass(`${bankBase}/textbook/high-yield`)}>
            <BookOpen className="h-[13px] w-[13px]" />
            <span>High-yield textbook</span>
          </Link>
          <Link href={`${bankBase}/textbook/extended`} className={navClass(`${bankBase}/textbook/extended`)}>
            <Library className="h-[13px] w-[13px]" />
            <span>Extended textbook</span>
          </Link>
        </SidebarSection>

        <SidebarSection title="Knowledge Tutor">
          <Link href={`${bankBase}/knowledge-tutor`} className={navClass(`${bankBase}/knowledge-tutor`)}>
            <Zap className="h-[13px] w-[13px]" />
            <span>Knowledge tutor</span>
          </Link>
          <Link href={`${bankBase}/review-facts`} className={navClass(`${bankBase}/review-facts`)}>
            <GraduationCap className="h-[13px] w-[13px]" />
            <span>Review facts</span>
          </Link>
          <Link href={`${bankBase}/performance`} className={navClass(`${bankBase}/performance`)}>
            <BarChart2 className="h-[13px] w-[13px]" />
            <span>Performance</span>
            <ChevronDown className="ml-auto h-3 w-3" />
          </Link>
        </SidebarSection>

        <SidebarSection title="Custom Revision">
          <Link href={`${bankBase}/revision-sets`} className={navClass(`${bankBase}/revision-sets`)}>
            <Wand2 className="h-[13px] w-[13px]" />
            <span>Revision sets</span>
          </Link>
        </SidebarSection>

        <SidebarSection title="Concepts">
          <Link href={`${bankBase}/concepts`} className={navClass(`${bankBase}/concepts`)}>
            <List className="h-[13px] w-[13px]" />
            <span>All concepts</span>
          </Link>
          <Link href={`${bankBase}/top-concepts`} className={navClass(`${bankBase}/top-concepts`)}>
            <CheckSquare className="h-[13px] w-[13px]" />
            <span>Top 100 concepts</span>
          </Link>
          <Link href={`${bankBase}/saved-concepts`} className={navClass(`${bankBase}/saved-concepts`)}>
            <Lightbulb className="h-[13px] w-[13px]" />
            <span>Saved concepts</span>
          </Link>
        </SidebarSection>
      </nav>

      <div className="mt-8 h-px bg-[#1f303e]" />
    </aside>
  );
}

function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.4px] text-[#a8b8c4]">
        {title}
      </div>
      <div className="space-y-[7px]">{children}</div>
    </div>
  );
}

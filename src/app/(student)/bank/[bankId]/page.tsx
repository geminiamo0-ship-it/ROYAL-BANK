'use client';

import React, { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { getQuestionBankCategories, startExamSession, type CategorySummary } from '@/actions/exam';
import {
  BarChart3,
  BookOpen,
  ChevronRight,
  Flame,
  SlidersHorizontal,
} from 'lucide-react';

const INITIAL_CATEGORIES: CategorySummary[] = [
  { id: 'Cardiology', name: 'Cardiology', total: 694, attempted: 0 },
  { id: 'Clinical Haematology / Oncology', name: 'Clinical haematology/oncology', total: 420, attempted: 0 },
  { id: 'Clinical Pharmacology & Toxicology', name: 'Clinical pharmacology and toxicology', total: 317, attempted: 0 },
  { id: 'Clinical Sciences', name: 'Clinical sciences', total: 571, attempted: 0 },
  { id: 'Dermatology', name: 'Dermatology', total: 257, attempted: 0 },
  { id: 'Endocrinology & Diabetes', name: 'Endocrinology', total: 446, attempted: 0 },
  { id: 'Gastroenterology & Hepatology', name: 'Gastroenterology', total: 413, attempted: 0 },
  { id: 'Geriatric Medicine', name: 'Geriatric medicine', total: 40, attempted: 0 },
  { id: 'Infectious Diseases & STIs', name: 'Infectious diseases and STIs', total: 573, attempted: 0 },
  { id: 'Nephrology & Renal Medicine', name: 'Nephrology', total: 275, attempted: 0 },
  { id: 'Neurology', name: 'Neurology', total: 554, attempted: 0 },
  { id: 'Ophthalmology', name: 'Ophthalmology', total: 100, attempted: 0 },
  { id: 'Palliative Medicine', name: 'Palliative medicine and end of life care', total: 38, attempted: 0 },
  { id: 'Psychiatry', name: 'Psychiatry', total: 132, attempted: 0 },
  { id: 'Respiratory Medicine', name: 'Respiratory medicine', total: 265, attempted: 0 },
  { id: 'Rheumatology', name: 'Rheumatology', total: 352, attempted: 0 },
];

const BANK_INFO: Record<number, { pathway: string; name: string; slug: string; average: number }> = {
  1: { pathway: 'MRCP Part 1', name: 'PassMedicine Edition', slug: 'mrcp-part-1', average: 87 },
  2: { pathway: 'MRCP Part 1', name: 'Pastest Edition', slug: 'mrcp-part-1', average: 82 },
  3: { pathway: 'MRCP Part 1', name: '1Exam / BMJ Edition', slug: 'mrcp-part-1', average: 79 },
  4: { pathway: 'MRCOG Part 1', name: 'O&G Core Bank', slug: 'mrcog-part-1', average: 76 },
  5: { pathway: 'MRCS Part A', name: 'Surgical Principles Bank', slug: 'mrcs-part-a', average: 74 },
  6: { pathway: 'PLAB 1 / UKMLA', name: 'Clinical Practice Bank', slug: 'plab-ukmla', average: 81 },
};

export default function QuestionBankHomePage() {
  const router = useRouter();
  const params = useParams();
  const bankId = Number(params.bankId || 1);
  const currentBank = BANK_INFO[bankId] || BANK_INFO[1];

  const [categories, setCategories] = useState<CategorySummary[]>(INITIAL_CATEGORIES);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let isMounted = true;

    async function loadCategories() {
      try {
        const nextCategories = await getQuestionBankCategories(bankId);
        if (!isMounted) return;
        if (nextCategories.length > 0) {
          setCategories(nextCategories);
        }
      } catch {
        // Keep the visual fallback so the home page still matches while data is being connected.
      }
    }

    loadCategories();
    return () => {
      isMounted = false;
    };
  }, [bankId]);

  const totalQuestions = useMemo(
    () => categories.reduce((sum, category) => sum + category.total, 0),
    [categories]
  );

  const handleContinue = () => {
    setError(null);
    startTransition(async () => {
      try {
        const sessionId = await startExamSession({
          bankId,
          categories: [],
          difficulties: ['1', '2', '3'],
          questionSelection: 'all',
          limit: 70,
        });
        router.push(`/exam/${sessionId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to continue questions.');
      }
    });
  };

  return (
    <div className="mx-auto max-w-[1048px] space-y-[18px] text-[12px] text-white">
      <section className="relative overflow-hidden rounded-[4px] bg-[#394046] px-[14px] py-[18px] shadow-[0_1px_2px_rgba(0,0,0,0.18)]">
        <div
          className="absolute right-[-60px] top-0 h-full w-[410px] bg-[#2e6a55]/55"
          style={{ clipPath: 'polygon(35% 0, 100% 0, 100% 40%, 25% 100%, 0 100%, 18% 35%)' }}
        />
        <div
          className="absolute right-[88px] top-0 h-full w-[190px] bg-[#2b5b50]/70"
          style={{ clipPath: 'polygon(48% 0, 100% 100%, 0 100%)' }}
        />

        <div className="relative flex items-center gap-3">
          <span className="flex h-[24px] items-end gap-[3px]">
            <span className="h-[13px] w-[5px] bg-[#ff2020]" />
            <span className="h-[17px] w-[5px] bg-[#fff100]" />
            <span className="h-[22px] w-[5px] bg-[#47d41f]" />
          </span>
          <h1 className="text-[26px] font-semibold tracking-[-0.5px] text-[#f2f2f2]">
            {currentBank.pathway}
          </h1>
        </div>

        <div className="relative mt-[50px] grid grid-cols-[1fr_170px_1fr] items-start gap-8">
          <ProgressCalendar tint="green" />

          <div className="flex flex-col items-center gap-[8px] pt-0">
            <StatPill tone="amber" value="0 today" />
            <StatPill tone="green" value="0 days" icon={<Flame className="h-3 w-3" />} />
            <StatPill tone="green" value={`${currentBank.average} average`} icon={<BarChart3 className="h-3 w-3" />} />
            <div className="rounded-[4px] bg-[#ffd4c8] px-3 py-[4px] text-[10px] font-semibold text-[#c23026]">
              17% - 0% - 0%
            </div>
          </div>

          <div className="relative">
            <Link
              href={`${bankBase(bankId)}/mock-exams`}
              className="absolute right-0 top-[-38px] text-[11px] text-[#d990f4] hover:underline"
            >
              Set exam date
            </Link>
            <ProgressCalendar tint="coral" />
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-[4px] border border-[#95413d] bg-[#3a2d2c] px-3 py-2 text-[12px] text-[#ffd4ce]">
          {error}
        </div>
      )}

      <section className="grid grid-cols-1 gap-[20px] lg:grid-cols-2">
        <Panel title="Question Bank" action={<SlidersHorizontal className="h-3 w-3 text-[#d88cff]" />}>
          <div className="mt-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-[12px] uppercase tracking-[0.2px] text-[#a2b0ba]">Standard</p>
              <h2 className="mt-[8px] text-[16px] font-semibold text-white">All categories</h2>
              <p className="mt-[18px] text-[12px] font-semibold text-white">1 day ago</p>
            </div>
            <button
              type="button"
              onClick={handleContinue}
              disabled={isPending}
              className="mt-0 inline-flex h-[25px] items-center gap-2 rounded-[3px] bg-[#d5e4ff] px-3 text-[12px] text-[#102148] hover:bg-[#e2ecff] disabled:opacity-60"
            >
              {isPending ? 'Starting...' : 'Continue questions'}
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </Panel>

        <Panel title="Textbooks">
          <div className="mt-4 flex flex-wrap gap-4">
            <Link
              href={`${bankBase(bankId)}/textbook/high-yield`}
              className="rounded-[3px] bg-[#ffd7ea] px-3 py-[7px] text-[12px] text-[#561035] hover:bg-[#ffe5f1]"
            >
              High-yield textbook
            </Link>
            <Link
              href={`${bankBase(bankId)}/textbook/extended`}
              className="rounded-[3px] bg-[#ffe6d2] px-3 py-[7px] text-[12px] text-[#5d2b0e] hover:bg-[#fff0e2]"
            >
              Extended textbook
              <ChevronRight className="ml-1 inline h-3 w-3" />
            </Link>
            <Link
              href={`${bankBase(bankId)}/textbook/high-yield?separate=true`}
              className="rounded-[3px] bg-[#ffd7ea] px-3 py-[7px] text-[12px] text-[#561035] hover:bg-[#ffe5f1]"
            >
              High-yield textbook in separate tab
              <ChevronRight className="ml-1 inline h-3 w-3" />
            </Link>
          </div>
        </Panel>

        <div className="hidden lg:block" />

        <Panel title="Knowledge Tutor" action={<SlidersHorizontal className="h-3 w-3 text-[#d88cff]" />}>
          <div className="mt-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[16px] font-semibold text-white">All categories</h2>
              <p className="mt-[18px] text-[12px] font-semibold text-white">1 week ago</p>
            </div>
            <Link
              href={`${bankBase(bankId)}/knowledge-tutor`}
              className="inline-flex h-[25px] items-center gap-2 rounded-[3px] bg-[#eadfff] px-3 text-[12px] text-[#271d48] hover:bg-[#f1eaff]"
            >
              Continue knowledge tutor
              <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
        </Panel>
      </section>

      <section className="grid grid-cols-1 gap-[20px] lg:grid-cols-3">
        <MiniPanel title="Questions" value={totalQuestions.toLocaleString()} label="available" />
        <MiniPanel title="Categories" value={categories.length.toString()} label="mapped topics" />
        <MiniPanel title="Current bank" value={currentBank.name} label="active edition" wide />
      </section>
    </div>
  );
}

function bankBase(bankId: number) {
  return `/bank/${bankId}`;
}

function Panel({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <article className="min-h-[124px] rounded-[4px] bg-[#353c42] shadow-[0_1px_3px_rgba(0,0,0,0.28)]">
      <div className="flex h-[28px] items-center justify-between border-b border-[#2a3035] px-[14px] text-[12px] uppercase tracking-[0.2px] text-[#4a4f54]">
        <span>{title}</span>
        {action}
      </div>
      <div className="px-[14px] pb-[14px]">{children}</div>
    </article>
  );
}

function MiniPanel({
  title,
  value,
  label,
  wide = false,
}: {
  title: string;
  value: string;
  label: string;
  wide?: boolean;
}) {
  return (
    <article className={`rounded-[4px] bg-[#353c42] px-[14px] py-3 ${wide ? 'lg:col-span-1' : ''}`}>
      <p className="text-[11px] uppercase text-[#7f8d96]">{title}</p>
      <p className="mt-1 truncate text-[16px] font-semibold text-white">{value}</p>
      <p className="text-[11px] text-[#a5b1ba]">{label}</p>
    </article>
  );
}

function StatPill({
  value,
  tone,
  icon,
}: {
  value: string;
  tone: 'amber' | 'green';
  icon?: React.ReactNode;
}) {
  const className =
    tone === 'amber'
      ? 'bg-[#fff5c9] text-[#8a5c00]'
      : 'bg-[#dff5df] text-[#1b6128]';

  return (
    <div className={`flex min-w-[82px] items-center justify-center gap-2 rounded-[5px] px-3 py-[4px] text-[10px] font-bold ${className}`}>
      {icon || <BookOpen className="h-3 w-3" />}
      <span>{value}</span>
    </div>
  );
}

function ProgressCalendar({ tint }: { tint: 'green' | 'coral' }) {
  const cells = Array.from({ length: 98 }, (_, index) => {
    const greenMarks = [2, 9, 18, 29, 47, 48, 56, 75, 83, 91];
    const coralMarks = [4, 16, 27, 35, 50, 67, 84, 96];
    const marks = tint === 'green' ? greenMarks : coralMarks;
    return marks.includes(index);
  });

  return (
    <div className="flex items-start justify-center gap-[6px]">
      <div className="space-y-[2px] pt-[1px] text-right text-[11px] leading-[12px] text-white">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => (
          <div key={`${day}-${index}`} className="h-[12px]">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-flow-col grid-rows-7 gap-[2px]">
        {cells.map((active, index) => (
          <span
            key={index}
            className={`h-[12px] w-[12px] rounded-[1px] border border-[#e2e8ef] ${
              active ? (tint === 'green' ? 'bg-[#87e38f]' : 'bg-[#ffd1c2]') : 'bg-[#f2f5f7]'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

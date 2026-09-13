'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarDays,
  Check,
  GripVertical,
  Plus,
  Trash2,
} from 'lucide-react';
import { createStudyPlanAction, updateStudyPlanAction } from '@/actions/study-plan';
import type {
  ActiveStudyPlan,
  StudyPlanCatalog,
  StudyPlanMissedStrategy,
  StudyPlanPeriodInput,
  StudyPlanSettingsInput,
} from '@/lib/study-plan';

const WEEKDAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function defaultDates() {
  const start = new Date();
  const exam = new Date(start);
  exam.setDate(exam.getDate() + 90);
  return { start: dateKey(start), exam: dateKey(exam) };
}

export function StudyPlanWizardClient({
  bankId,
  catalog,
  initialPlan,
}: {
  bankId: number;
  catalog: StudyPlanCatalog;
  initialPlan?: ActiveStudyPlan | null;
}) {
  const router = useRouter();
  const defaults = useMemo(defaultDates, []);
  const initialCategoryOrder = useMemo(() => {
    if (!initialPlan) return catalog.categories.map((category) => category.name);
    const priorities = new Map(initialPlan.categories.map((item) => [item.category, item.priority]));
    return catalog.categories
      .map((category, index) => ({ name: category.name, priority: priorities.get(category.name) ?? 100000 + index }))
      .sort((a, b) => a.priority - b.priority)
      .map((item) => item.name);
  }, [catalog.categories, initialPlan]);

  const [step, setStep] = useState(1);
  const [startDate, setStartDate] = useState(initialPlan?.startDate ?? defaults.start);
  const [examDate, setExamDate] = useState(initialPlan?.examDate ?? defaults.exam);
  const [studyWeekdays, setStudyWeekdays] = useState<number[]>(initialPlan?.studyWeekdays ?? [1, 2, 3, 4, 5]);
  const [missedStrategy, setMissedStrategy] = useState<StudyPlanMissedStrategy>(initialPlan?.missedStrategy ?? 'redistribute');
  const [reducedLoadFactor, setReducedLoadFactor] = useState(initialPlan?.reducedLoadFactor ?? 0.5);
  const [periods, setPeriods] = useState<StudyPlanPeriodInput[]>(
    initialPlan?.periods.map(({ startDate: from, endDate: to, mode }) => ({ startDate: from, endDate: to, mode })) ?? [],
  );
  const [categoryOrder, setCategoryOrder] = useState(initialCategoryOrder);
  const [draggedCategory, setDraggedCategory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const topicCount = catalog.topicCount;
  const totalQuestions = catalog.categories.reduce(
    (sum, category) => sum + category.topics.reduce((topicSum, topic) => topicSum + topic.questionCount, 0),
    0,
  );

  const validateStep = () => {
    setError(null);
    if (step === 1) {
      if (!startDate || !examDate || examDate <= startDate) {
        setError('Exam date must be after your plan start date.');
        return false;
      }
    }
    if (step === 2 && studyWeekdays.length === 0) {
      setError('Choose at least one study day each week.');
      return false;
    }
    return true;
  };

  const next = () => {
    if (!validateStep()) return;
    setStep((current) => Math.min(4, current + 1));
  };

  const toggleWeekday = (day: number) => {
    setStudyWeekdays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day]);
  };

  const addPeriod = () => {
    setPeriods((current) => [...current, { startDate, endDate: startDate, mode: 'pause' }]);
  };

  const updatePeriod = (index: number, patch: Partial<StudyPlanPeriodInput>) => {
    setPeriods((current) => current.map((period, itemIndex) => itemIndex === index ? { ...period, ...patch } : period));
  };

  const moveCategory = (name: string, direction: -1 | 1) => {
    setCategoryOrder((current) => {
      const index = current.indexOf(name);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const nextOrder = [...current];
      [nextOrder[index], nextOrder[target]] = [nextOrder[target], nextOrder[index]];
      return nextOrder;
    });
  };

  const dropCategory = (target: string) => {
    if (!draggedCategory || draggedCategory === target) return;
    setCategoryOrder((current) => {
      const without = current.filter((item) => item !== draggedCategory);
      const targetIndex = without.indexOf(target);
      without.splice(targetIndex, 0, draggedCategory);
      return without;
    });
    setDraggedCategory(null);
  };

  const buildInput = (): StudyPlanSettingsInput => ({
    startDate,
    examDate,
    studyWeekdays,
    missedStrategy,
    reducedLoadFactor,
    periods,
    categoryPriorities: categoryOrder.map((category, priority) => ({ category, priority })),
  });

  const save = () => {
    if (!validateStep()) return;
    setError(null);
    startTransition(async () => {
      const result = initialPlan
        ? await updateStudyPlanAction(initialPlan.id, buildInput())
        : await createStudyPlanAction(bankId, buildInput());
      if (!result.ok) {
        setError(result.message.replace(/^STUDY_PLAN_/, '').replaceAll('_', ' ').toLowerCase());
        return;
      }
      router.push(`/bank/${bankId}/study-plan`);
      router.refresh();
    });
  };

  return (
    <div className="mx-auto max-w-[900px] space-y-5 pb-16 text-slate-900 dark:text-white">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/bank/${bankId}/study-plan`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" /> Study Plan
        </Link>
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#a17c35]">Step {step} of 4</span>
      </div>

      <section className="overflow-hidden rounded-2xl border border-[#ded6c7] bg-[#fffdf8] shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <div className="border-b border-[#ebe5d9] px-6 py-5 dark:border-slate-800">
          <h1 className="text-2xl font-semibold tracking-[-0.035em] text-[#172238] dark:text-white">{initialPlan ? 'Edit Study Plan' : 'Create Study Plan'}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{topicCount.toLocaleString()} topics · {totalQuestions.toLocaleString()} linked questions</p>
          <div className="mt-5 grid grid-cols-4 gap-2">
            {[1, 2, 3, 4].map((item) => <div key={item} className={`h-1 rounded-full ${item <= step ? 'bg-[#b58a3d]' : 'bg-[#e8e2d6] dark:bg-slate-800'}`} />)}
          </div>
        </div>

        <div className="p-6 sm:p-8">
          {step === 1 ? (
            <div className="space-y-6">
              <StepHeading title="Set the finish line" description="Your plan runs from the start date through the day before your exam." />
              <div className="grid gap-4 sm:grid-cols-2">
                <DateField label="Start date" value={startDate} onChange={setStartDate} />
                <DateField label="Exam date" value={examDate} onChange={setExamDate} />
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-7">
              <StepHeading title="Build around real life" description="Choose normal study days, then add periods where university work should pause or reduce the load." />
              <div>
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Weekly study days</p>
                <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-7">
                  {WEEKDAYS.map((day) => {
                    const selected = studyWeekdays.includes(day.value);
                    return <button key={day.value} type="button" onClick={() => toggleWeekday(day.value)} className={`h-10 rounded-lg border text-xs font-semibold transition ${selected ? 'border-[#b58a3d] bg-[#f5eddc] text-[#6c5630] dark:bg-amber-950/35 dark:text-amber-200' : 'border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'}`}>{day.label}</button>;
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/60">
                <div className="flex items-center justify-between gap-3">
                  <div><p className="text-xs font-semibold">University exam periods</p><p className="mt-1 text-[11px] text-slate-400">Pause completely or keep a reduced study load.</p></div>
                  <button type="button" onClick={addPeriod} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-[11px] font-semibold dark:border-slate-700"><Plus className="h-3.5 w-3.5" /> Add period</button>
                </div>
                <div className="mt-4 space-y-3">
                  {periods.map((period, index) => (
                    <div key={`${index}-${period.startDate}`} className="grid gap-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-950 sm:grid-cols-[1fr_1fr_120px_34px]">
                      <input type="date" value={period.startDate} onChange={(event) => updatePeriod(index, { startDate: event.target.value })} className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900" />
                      <input type="date" value={period.endDate} onChange={(event) => updatePeriod(index, { endDate: event.target.value })} className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900" />
                      <select value={period.mode} onChange={(event) => updatePeriod(index, { mode: event.target.value === 'reduced' ? 'reduced' : 'pause' })} className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"><option value="pause">Pause</option><option value="reduced">Reduced</option></select>
                      <button type="button" onClick={() => setPeriods((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="flex h-9 items-center justify-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  ))}
                  {periods.length === 0 ? <p className="py-2 text-center text-[11px] text-slate-400">No special periods added.</p> : null}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2"><span className="text-xs font-semibold">If you miss a topic</span><select value={missedStrategy} onChange={(event) => setMissedStrategy(event.target.value === 'next_free_day' ? 'next_free_day' : 'redistribute')} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-900"><option value="redistribute">Redistribute remaining workload</option><option value="next_free_day">Move to next empty study day</option></select></label>
                <label className="space-y-2"><span className="text-xs font-semibold">Reduced load</span><select value={String(reducedLoadFactor)} onChange={(event) => setReducedLoadFactor(Number(event.target.value))} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-900"><option value="0.25">25% of normal</option><option value="0.5">50% of normal</option><option value="0.75">75% of normal</option></select></label>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-6">
              <StepHeading title="Choose what comes first" description="Drag categories into priority order. Topics inside each category stay deterministic and are spread evenly over available capacity." />
              <div className="space-y-2">
                {categoryOrder.map((name, index) => {
                  const category = catalog.categories.find((item) => item.name === name);
                  return (
                    <div key={name} draggable onDragStart={() => setDraggedCategory(name)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropCategory(name)} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-900">
                      <GripVertical className="h-4 w-4 cursor-grab text-slate-300" />
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#f5eddc] text-[11px] font-semibold text-[#795e2c] dark:bg-amber-950/35 dark:text-amber-200">{index + 1}</span>
                      <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{name}</p><p className="text-[11px] text-slate-400">{category?.topicCount ?? 0} topics</p></div>
                      <div className="flex gap-1"><button type="button" onClick={() => moveCategory(name, -1)} disabled={index === 0} className="rounded p-1 text-slate-400 hover:bg-slate-50 disabled:opacity-25 dark:hover:bg-slate-800"><ArrowUp className="h-3.5 w-3.5" /></button><button type="button" onClick={() => moveCategory(name, 1)} disabled={index === categoryOrder.length - 1} className="rounded p-1 text-slate-400 hover:bg-slate-50 disabled:opacity-25 dark:hover:bg-slate-800"><ArrowDown className="h-3.5 w-3.5" /></button></div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-6">
              <StepHeading title="Review your plan" description="Royal will schedule every currently linked topic using weighted study-day capacity. Completed topics stay fixed when you edit or rebalance later." />
              <div className="grid gap-3 sm:grid-cols-2">
                <ReviewCard label="Plan window" value={`${startDate} → ${examDate}`} />
                <ReviewCard label="Topics" value={topicCount.toLocaleString()} />
                <ReviewCard label="Study days" value={`${studyWeekdays.length} days / week`} />
                <ReviewCard label="Missed topics" value={missedStrategy === 'next_free_day' ? 'Next empty day, then redistribute' : 'Redistribute remaining days'} />
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><p className="text-xs font-semibold">Priority order</p><p className="mt-2 text-xs leading-6 text-slate-500">{categoryOrder.join(' → ')}</p></div>
            </div>
          ) : null}

          {error ? <div className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{error}</div> : null}

          <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-5 dark:border-slate-800">
            <button type="button" onClick={() => setStep((current) => Math.max(1, current - 1))} disabled={step === 1 || isPending} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 disabled:opacity-30 dark:border-slate-700 dark:text-slate-300"><ArrowLeft className="h-3.5 w-3.5" /> Back</button>
            {step < 4 ? <button type="button" onClick={next} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#172238] px-4 text-xs font-semibold text-white dark:bg-[#d6b76b] dark:text-slate-950">Continue <ArrowRight className="h-3.5 w-3.5" /></button> : <button type="button" onClick={save} disabled={isPending || topicCount === 0} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#172238] px-4 text-xs font-semibold text-white disabled:opacity-50 dark:bg-[#d6b76b] dark:text-slate-950"><Check className="h-3.5 w-3.5" /> {isPending ? 'Building plan…' : initialPlan ? 'Save changes' : 'Create plan'}</button>}
          </div>
        </div>
      </section>
    </div>
  );
}

function StepHeading({ title, description }: { title: string; description: string }) {
  return <div><h2 className="text-lg font-semibold tracking-[-0.02em] text-[#172238] dark:text-white">{title}</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p></div>;
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><span className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200"><CalendarDays className="h-3.5 w-3.5 text-[#a17c35]" /> {label}</span><input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="mt-3 h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-[#b58a3d] dark:border-slate-700 dark:bg-slate-950" /></label>;
}

function ReviewCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</p><p className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">{value}</p></div>;
}

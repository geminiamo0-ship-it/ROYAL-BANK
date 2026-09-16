'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  CalendarDays,
  Check,
  CircleAlert,
  Pencil,
  Play,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import {
  linkStudyPlanSessionAction,
  markStudyPlanTaskCompleteAction,
  rebalanceStudyPlanAction,
} from '@/actions/study-plan';
import { startExamSession } from '@/lib/exam-launch';
import { encodeTopicFilter } from '@/lib/topic-filters';
import type { ActiveStudyPlan, StudyPlanDashboard, StudyPlanTask } from '@/lib/study-plan';

const SUBJECT_BAR_CLASSES = [
  'bg-emerald-400',
  'bg-amber-300',
  'bg-sky-400',
  'bg-violet-400',
  'bg-pink-400',
  'bg-cyan-300',
];

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromKey(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

function prettyDate(value: string): string {
  return new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' }).format(dateFromKey(value));
}

function compactDate(value: string): string {
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }).format(dateFromKey(value));
}

function daysUntil(from: string, to: string): number {
  const diff = dateFromKey(to).getTime() - dateFromKey(from).getTime();
  return Math.max(0, Math.ceil(diff / 86_400_000));
}

function planStatusCopy(status: ActiveStudyPlan['status']) {
  if (status === 'behind') {
    return { label: 'Behind', className: 'border-rose-500/35 bg-rose-500/10 text-rose-300' };
  }
  if (status === 'ahead') {
    return { label: 'Ahead', className: 'border-emerald-400/35 bg-emerald-400/10 text-emerald-300' };
  }
  return { label: 'On track', className: 'border-emerald-400/35 bg-emerald-400/10 text-emerald-300' };
}

function weekRows(tasks: StudyPlanTask[], today: string, studyWeekdays: number[]) {
  const base = dateFromKey(today);
  const day = base.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(base);
  monday.setDate(base.getDate() + mondayOffset);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    const key = localDateKey(date);
    return {
      key,
      date,
      label: new Intl.DateTimeFormat('en', { weekday: 'short' }).format(date),
      tasks: tasks.filter((task) => task.scheduledDate === key),
      isRest: !studyWeekdays.includes(date.getDay()),
    };
  });
}

function monthCells(today: string) {
  const current = dateFromKey(today);
  const first = new Date(current.getFullYear(), current.getMonth(), 1, 12);
  const mondayIndex = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - mondayIndex);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      date,
      key: localDateKey(date),
      inCurrentMonth: date.getMonth() === current.getMonth(),
    };
  });
}

export function StudyPlanDashboardClient({
  bankId,
  initialDashboard,
}: {
  bankId: number;
  initialDashboard: StudyPlanDashboard;
}) {
  const router = useRouter();
  const plan = initialDashboard.plan;
  const [error, setError] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!plan) {
    const topicCount = initialDashboard.catalog?.topicCount ?? 0;
    return (
      <div className="mx-auto max-w-[1180px] pb-16 text-white">
        <section className="overflow-hidden rounded-xl border border-[#21445b] bg-[#0a2940]/95 shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
          <div className="grid gap-8 px-6 py-9 md:grid-cols-[1.35fr_0.65fr] md:px-10 md:py-12">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#b58a3d]/40 bg-[#b58a3d]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#f0cf78]">
                <Sparkles className="h-3.5 w-3.5" /> Preparation Progress
              </div>
              <h1 className="max-w-2xl text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
                Turn the whole bank into a plan you can actually finish.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-[#9fb3c3]">
                Royal schedules topics around your exam date, study week and university commitments.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link
                  href={`/bank/${bankId}/study-plan/create`}
                  aria-disabled={topicCount === 0}
                  className={`inline-flex h-10 items-center gap-2 rounded-lg px-5 text-sm font-semibold transition ${
                    topicCount > 0
                      ? 'bg-[#f2cf70] text-[#0b1b29] hover:bg-[#f7dc91]'
                      : 'pointer-events-none bg-[#17364c] text-[#688196]'
                  }`}
                >
                  Create Study Plan <ArrowRight className="h-4 w-4" />
                </Link>
                <span className="text-xs text-[#7f9aae]">
                  {topicCount > 0 ? `${topicCount.toLocaleString()} topics ready to schedule` : 'Waiting for question topics to be uploaded'}
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-[#22455d] bg-[#0d314a]/75 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6f91a8]">How it works</p>
              <div className="mt-4 space-y-4 text-sm text-[#c7d5df]">
                <div className="flex gap-3"><span className="font-semibold text-[#f2cf70]">01</span><span>Set your exam date and real study days.</span></div>
                <div className="flex gap-3"><span className="font-semibold text-[#f2cf70]">02</span><span>Pause or reduce load around university exams.</span></div>
                <div className="flex gap-3"><span className="font-semibold text-[#f2cf70]">03</span><span>Prioritise categories; Royal distributes the remaining topics.</span></div>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const today = localDateKey();
  const todayTasks = plan.tasks.filter((task) => task.scheduledDate === today);
  const overdue = plan.tasks.filter((task) => task.status === 'pending' && task.scheduledDate < today);
  const week = weekRows(plan.tasks, today, plan.studyWeekdays);
  const calendar = monthCells(today);
  const status = planStatusCopy(plan.status);
  const remainingTopics = Math.max(0, plan.totalTopics - plan.completedTopics);
  const totalQuestions = plan.tasks.reduce((sum, task) => sum + task.questionCount, 0);
  const remainingQuestions = Math.max(0, totalQuestions - plan.questionsPracticed);
  const remainingQuestionPct = totalQuestions > 0 ? Math.round((remainingQuestions / totalQuestions) * 100) : 0;
  const examDaysRemaining = daysUntil(today, plan.examDate);
  const weekTopicCount = week.reduce((sum, row) => sum + row.tasks.length, 0);
  const restDays = week.filter((row) => row.isRest).length;
  const monthLabel = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(dateFromKey(today));

  const markComplete = (task: StudyPlanTask) => {
    setBusyTaskId(task.id);
    setError(null);
    startTransition(async () => {
      const result = await markStudyPlanTaskCompleteAction(task.id);
      setBusyTaskId(null);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  };

  const startTopicSession = (task: StudyPlanTask) => {
    if (task.questionCount <= 0 || task.examFilters.length === 0) {
      setError('No live questions are linked to this topic yet.');
      return;
    }

    setBusyTaskId(task.id);
    setError(null);
    startTransition(async () => {
      try {
        const sessionId = await startExamSession({
          bankId,
          categories: [],
          topicFilters: task.examFilters.map((filter) => encodeTopicFilter(filter.category, filter.topic)),
          difficulties: ['1', '2', '3'],
          questionSelection: 'new_only',
          sessionType: 'tutor',
          limit: Math.max(1, Math.min(40, task.questionCount)),
        });
        await linkStudyPlanSessionAction(task.id, sessionId);
        router.push(`/exam/${sessionId}`);
      } catch (launchError) {
        setBusyTaskId(null);
        setError(launchError instanceof Error ? launchError.message : 'Unable to start this topic session.');
      }
    });
  };

  const rebalance = () => {
    setError(null);
    startTransition(async () => {
      const result = await rebalanceStudyPlanAction(plan.id, plan.missedStrategy);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="mx-auto max-w-[1180px] space-y-4 pb-12 text-white">
      <header className="relative overflow-hidden rounded-xl border border-[#1b3d54] bg-[linear-gradient(105deg,rgba(24,61,86,0.96)_0%,rgba(10,31,48,0.86)_46%,rgba(7,22,34,0.5)_72%,rgba(7,22,34,0)_100%)] px-5 py-4 sm:px-6">
        <div className="pointer-events-none absolute inset-y-0 left-[28%] w-[260px] skew-x-[-24deg] bg-[#315b7a]/15" />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-[28px] font-semibold tracking-[-0.035em] text-white">Study Plan</h1>
            <p className="mt-1 text-sm text-[#a8bdcb]">MRCP Part 1 · Exam in {examDaysRemaining.toLocaleString()} days</p>
          </div>
          <Link
            href={`/bank/${bankId}/study-plan/create?edit=1`}
            className="inline-flex h-9 items-center gap-2 self-start rounded-md border border-[#3a6480] bg-[#0c2a40]/85 px-3 text-xs font-semibold text-[#d9e6ee] transition hover:border-[#5a829b] hover:bg-[#12344c]"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit plan
          </Link>
        </div>
      </header>

      {error ? (
        <div className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      ) : null}

      <section className="rounded-xl border border-[#25506a] bg-[linear-gradient(120deg,#0b3048_0%,#09273c_58%,#082235_100%)] p-5 shadow-[0_12px_35px_rgba(0,0,0,0.2)] sm:p-6">
        <div className="grid gap-6 lg:grid-cols-[1.55fr_0.95fr] lg:items-stretch">
          <div className="min-w-0">
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold ${status.className}`}>
              <span className="h-2 w-2 rounded-full bg-current" /> {status.label}
            </span>

            <div className="mt-5 space-y-4">
              <ProgressLine
                label={`${plan.completedTopics.toLocaleString()} / ${plan.totalTopics.toLocaleString()} topics completed`}
                percent={Math.round(plan.progress)}
                barClass="bg-[#f2cf70]"
                showPercent
              />
              <div className="border-t border-[#31536a]/70 pt-4">
                <ProgressLine
                  title="QBank remaining"
                  label={`${remainingQuestions.toLocaleString()} / ${totalQuestions.toLocaleString()} questions left`}
                  percent={remainingQuestionPct}
                  barClass="bg-[#47c4f1]"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 divide-x divide-[#31536a]/80 border-t border-[#31536a]/70 pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
            <HeroMetric value={remainingTopics.toLocaleString()} label="topics remaining" />
            <HeroMetric value={todayTasks.length.toLocaleString()} label="topics today" />
            <HeroMetric value={examDaysRemaining.toLocaleString()} label="days remaining" />
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.58fr_0.92fr]">
        <section className="overflow-hidden rounded-xl border border-[#244c65] bg-[#0a2a40]/95 shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
          <div className="flex items-start justify-between gap-4 border-b border-[#2c4c61] px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Today</h2>
              <p className="mt-0.5 text-xs text-[#8ea9ba]">{todayTasks.length} topics planned · Keep going!</p>
            </div>
            <span className="text-xs text-[#9eb4c3]">{prettyDate(today)}</span>
          </div>

          <div className="divide-y divide-[#27465b]">
            {todayTasks.length > 0 ? todayTasks.map((task) => (
              <TaskRow
                key={task.id}
                bankId={bankId}
                task={task}
                busy={isPending && busyTaskId === task.id}
                onStart={() => startTopicSession(task)}
                onComplete={() => markComplete(task)}
              />
            )) : (
              <div className="px-5 py-10 text-center">
                <Check className="mx-auto h-6 w-6 text-emerald-400" />
                <p className="mt-2 text-sm font-semibold text-[#d7e3ea]">No topics scheduled for today</p>
                <p className="mt-1 text-xs text-[#7995a8]">Use the space to review, catch up, or take the day off.</p>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-[#244c65] bg-[#0a2a40]/95 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
          <div className="flex items-start justify-between gap-4 border-b border-[#2c4c61] pb-3">
            <div>
              <div className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-[#f2cf70]" />
                <h2 className="text-lg font-semibold text-white">This Week</h2>
              </div>
              <p className="mt-0.5 pl-7 text-xs text-[#8ea9ba]">{weekTopicCount} topics · {restDays} rest days</p>
            </div>
            <a href="#schedule" className="text-xs font-semibold text-[#62c6ff] hover:text-[#8bd5ff]">View full plan</a>
          </div>

          <div className="mt-2 divide-y divide-[#27465b]">
            {week.map((row) => (
              <div key={row.key} className={`grid grid-cols-[42px_64px_1fr_auto] items-center gap-2 py-2 text-xs ${row.isRest && row.tasks.length === 0 ? 'rounded-md bg-[#12344d]/70 px-2' : ''}`}>
                <span className="font-semibold text-[#d7e3ea]">{row.label}</span>
                <span className="text-[#8ea9ba]">{compactDate(row.key)}</span>
                {row.tasks.length > 0 ? (
                  <div className="flex min-w-0 items-center gap-1.5">
                    {row.tasks.slice(0, 4).map((task) => (
                      <span key={task.id} className={`h-3.5 w-3.5 rounded-full border ${task.status === 'completed' ? 'border-emerald-300 bg-emerald-400' : 'border-[#f2cf70] bg-[#f2cf70]'}`} />
                    ))}
                    {row.tasks.length > 4 ? <span className="ml-1 text-[10px] text-[#7894a7]">+{row.tasks.length - 4}</span> : null}
                  </div>
                ) : row.isRest ? (
                  <span className="text-[#f2cf70]">● <span className="ml-1 text-[#a9bcc9]">Rest day</span></span>
                ) : (
                  <span className="text-[#52758d]">○</span>
                )}
                <span className="text-right text-[#a9bcc9]">{row.tasks.length > 0 ? `${row.tasks.length} topics` : ''}</span>
              </div>
            ))}
          </div>

          {overdue.length > 0 ? (
            <div className="mt-3 flex items-center justify-end gap-2 border-t border-[#2c4c61] pt-3">
              <CircleAlert className="h-3.5 w-3.5 text-rose-400" />
              <span className="text-[11px] font-semibold text-rose-300">{overdue.length} overdue {overdue.length === 1 ? 'topic' : 'topics'}</span>
              <button
                type="button"
                onClick={rebalance}
                disabled={isPending}
                className="ml-1 inline-flex items-center gap-1 text-[11px] font-semibold text-[#62c6ff] disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${isPending ? 'animate-spin' : ''}`} /> Rebalance
              </button>
            </div>
          ) : null}
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-[#244c65] bg-[#0a2a40]/95 p-5 shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
          <div className="flex items-center justify-between border-b border-[#2c4c61] pb-3">
            <h2 className="text-base font-semibold text-white">Subject Progress</h2>
            <span className="text-xs font-semibold text-[#62c6ff]">View all subjects</span>
          </div>

          <div className="mt-3 grid grid-cols-[minmax(130px,1fr)_1.7fr_92px] gap-x-3 text-[11px] text-[#7794a7]">
            <span>Subject</span><span>Progress</span><span className="text-right">Topics</span>
          </div>
          <div className="mt-1 divide-y divide-[#27465b]">
            {plan.categories.slice(0, 6).map((category, index) => (
              <div key={category.category} className="grid grid-cols-[minmax(130px,1fr)_1.7fr_92px] items-center gap-x-3 py-2.5 text-xs">
                <span className="truncate font-medium text-[#e0e9ef]">{category.category}</span>
                <div className="flex items-center gap-3">
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[#153d58]">
                    <div className={`h-full rounded-full ${SUBJECT_BAR_CLASSES[index % SUBJECT_BAR_CLASSES.length]}`} style={{ width: `${Math.min(100, Math.max(0, category.progress))}%` }} />
                  </div>
                  <span className="w-9 text-right font-semibold text-[#dbe6ed]">{Math.round(category.progress)}%</span>
                </div>
                <span className="text-right text-[#9eb2c0]">{category.completed}/{category.total}</span>
              </div>
            ))}
          </div>
        </section>

        <section id="schedule" className="rounded-xl border border-[#244c65] bg-[#0a2a40]/95 p-5 shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
          <div className="flex items-center justify-between border-b border-[#2c4c61] pb-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-[#f2cf70]" />
              <h2 className="text-base font-semibold text-white">Schedule</h2>
            </div>
            <span className="text-sm font-semibold text-[#d8e4eb]">{monthLabel}</span>
          </div>

          <div className="mt-4 grid grid-cols-7 text-center text-[11px] font-medium text-[#7996a8]">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="mt-2 grid grid-cols-7 gap-y-2">
            {calendar.map((cell) => {
              const tasks = plan.tasks.filter((task) => task.scheduledDate === cell.key);
              const complete = tasks.length > 0 && tasks.every((task) => task.status === 'completed');
              const planned = tasks.some((task) => task.status === 'pending');
              const rest = !plan.studyWeekdays.includes(cell.date.getDay());
              const isToday = cell.key === today;
              return (
                <div key={cell.key} className={`flex min-h-9 flex-col items-center justify-start text-xs ${cell.inCurrentMonth ? 'text-[#dce6ec]' : 'text-[#4f6c80]'}`}>
                  <span className={`flex h-7 w-7 items-center justify-center rounded-full ${isToday ? 'bg-[#f2cf70] font-bold text-[#0a2132]' : ''}`}>{cell.date.getDate()}</span>
                  <span className={`mt-1 h-2 w-2 rounded-full ${complete ? 'bg-emerald-400' : planned ? 'bg-[#f2cf70]' : rest ? 'bg-[#7191aa]' : 'border border-[#55778f]'}`} />
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[#2c4c61] pt-3 text-[10px] text-[#91a9b9]">
            <LegendDot className="bg-emerald-400" label="Completed" />
            <LegendDot className="bg-[#f2cf70]" label="Planned" />
            <LegendDot className="bg-[#7191aa]" label="Rest day" />
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border border-[#55778f]" /> No study</span>
          </div>
        </section>
      </div>
    </div>
  );
}

function ProgressLine({
  title,
  label,
  percent,
  barClass,
  showPercent = false,
}: {
  title?: string;
  label: string;
  percent: number;
  barClass: string;
  showPercent?: boolean;
}) {
  return (
    <div>
      {title ? <p className="text-sm font-semibold text-[#e4edf2]">{title}</p> : null}
      <div className={`${title ? 'mt-1' : ''} grid gap-3 sm:grid-cols-[240px_1fr_auto] sm:items-center`}>
        <p className="text-sm text-[#a8bdcb]">{label}</p>
        <div className="h-3 overflow-hidden rounded-full bg-[#173c57]">
          <div className={`h-full rounded-full transition-all ${barClass}`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
        </div>
        {showPercent ? <span className="text-xs font-semibold text-[#dce6ec]">{percent}%</span> : <span className="hidden sm:block sm:w-8" />}
      </div>
    </div>
  );
}

function HeroMetric({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-3 text-center">
      <div className="text-2xl font-semibold tracking-[-0.03em] text-white">{value}</div>
      <div className="mt-1 max-w-[90px] text-xs leading-5 text-[#a9bcc9]">{label}</div>
    </div>
  );
}

function TaskRow({
  bankId,
  task,
  busy,
  onStart,
  onComplete,
}: {
  bankId: number;
  task: StudyPlanTask;
  busy: boolean;
  onStart: () => void;
  onComplete: () => void;
}) {
  const completed = task.status === 'completed';
  return (
    <div className="grid gap-3 px-5 py-4 sm:grid-cols-[34px_minmax(0,1fr)_auto] sm:items-center">
      <button
        type="button"
        onClick={onComplete}
        disabled={busy || completed}
        aria-label={completed ? `${task.topic} completed` : `Mark ${task.topic} complete`}
        className={`flex h-6 w-6 items-center justify-center rounded-md border transition ${completed ? 'border-emerald-400 bg-emerald-400 text-[#062319]' : 'border-[#5c8198] bg-[#0c2b42] text-transparent hover:border-[#8eb0c3]'} disabled:opacity-60`}
      >
        <Check className="h-3.5 w-3.5" />
      </button>

      <div className="min-w-0">
        <h3 className={`truncate text-sm font-semibold ${completed ? 'text-[#7894a7] line-through' : 'text-white'}`}>{task.topic}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[#8da8b9]">
          <span className="rounded-full border border-[#2d5670] bg-[#123750] px-2 py-0.5 text-[#b5cad7]">{task.category}</span>
          <span>{task.questionCount.toLocaleString()} questions</span>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:justify-end">
        {task.articleId ? (
          <Link
            href={`/bank/${bankId}/textbook/high-yield/${encodeURIComponent(task.articleId)}`}
            className="inline-flex h-9 items-center justify-center rounded-md border border-[#547990] bg-[#0e2c43] px-4 text-xs font-semibold text-[#e0eaf0] transition hover:border-[#7497ab] hover:bg-[#14364e]"
          >
            Study
          </Link>
        ) : (
          <button type="button" disabled className="inline-flex h-9 items-center justify-center rounded-md border border-[#29485b] bg-[#0c273b] px-4 text-xs font-semibold text-[#57768a]">Study</button>
        )}
        {!completed ? (
          <button
            type="button"
            onClick={onStart}
            disabled={busy || task.questionCount <= 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#f2cf70] px-4 text-xs font-semibold text-[#0a1c29] transition hover:bg-[#f7dc91] disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5 fill-current" /> {busy ? 'Starting…' : 'Practice'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${className}`} /> {label}</span>;
}

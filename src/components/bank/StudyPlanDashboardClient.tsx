'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  CircleAlert,
  Clock3,
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

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function prettyDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' }).format(date);
}

function planStatusCopy(status: ActiveStudyPlan['status']) {
  if (status === 'behind') {
    return { label: 'Behind', className: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/35 dark:text-rose-300' };
  }
  if (status === 'ahead') {
    return { label: 'Ahead', className: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/35 dark:text-emerald-300' };
  }
  return { label: 'On track', className: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/35 dark:text-amber-300' };
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
      <div className="mx-auto max-w-[1048px] pb-16">
        <section className="overflow-hidden rounded-2xl border border-[#d8d1c2] bg-[#fffdf8] shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="grid gap-8 px-6 py-9 md:grid-cols-[1.35fr_0.65fr] md:px-10 md:py-12">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#d7c49a] bg-[#f5eddc] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6c5630] dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300">
                <Sparkles className="h-3.5 w-3.5" /> Preparation Progress
              </div>
              <h1 className="max-w-2xl text-3xl font-semibold tracking-[-0.04em] text-[#172238] dark:text-white sm:text-4xl">
                Turn the whole bank into a plan you can actually finish.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                Royal schedules topics — not arbitrary question quotas — around your exam date, study week and university commitments.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link
                  href={`/bank/${bankId}/study-plan/create`}
                  aria-disabled={topicCount === 0}
                  className={`inline-flex h-10 items-center gap-2 rounded-lg px-5 text-sm font-semibold transition ${
                    topicCount > 0
                      ? 'bg-[#172238] text-white hover:bg-[#24324f] dark:bg-[#d6b76b] dark:text-slate-950 dark:hover:bg-[#e1c57f]'
                      : 'pointer-events-none bg-slate-200 text-slate-400 dark:bg-slate-800 dark:text-slate-500'
                  }`}
                >
                  Create Study Plan <ArrowRight className="h-4 w-4" />
                </Link>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {topicCount > 0 ? `${topicCount.toLocaleString()} topics ready to schedule` : 'Waiting for question topics to be uploaded'}
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-[#e6dfd1] bg-white/80 p-5 dark:border-slate-800 dark:bg-slate-900/70">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">How it works</p>
              <div className="mt-4 space-y-4 text-sm text-slate-700 dark:text-slate-200">
                <div className="flex gap-3"><span className="font-semibold text-[#a17c35]">01</span><span>Set your exam date and real study days.</span></div>
                <div className="flex gap-3"><span className="font-semibold text-[#a17c35]">02</span><span>Pause or reduce load around university exams.</span></div>
                <div className="flex gap-3"><span className="font-semibold text-[#a17c35]">03</span><span>Prioritise categories; Royal distributes the remaining topics.</span></div>
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
  const upcomingGroups = useMemo(() => {
    const grouped = new Map<string, StudyPlanTask[]>();
    for (const task of plan.tasks) {
      if (task.scheduledDate < today || task.status === 'completed') continue;
      const list = grouped.get(task.scheduledDate) ?? [];
      list.push(task);
      grouped.set(task.scheduledDate, list);
    }
    return Array.from(grouped.entries()).slice(0, 10);
  }, [plan.tasks, today]);
  const status = planStatusCopy(plan.status);

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
    <div className="mx-auto max-w-[1048px] space-y-5 pb-16 text-slate-900 dark:text-white">
      <section className="rounded-2xl border border-[#ded6c7] bg-[#fffdf8] p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950 sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${status.className}`}>{status.label}</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">Exam {prettyDate(plan.examDate)}</span>
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-[-0.035em] text-[#172238] dark:text-white">Preparation Progress</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {plan.completedTopics.toLocaleString()} of {plan.totalTopics.toLocaleString()} topics completed
            </p>
          </div>
          <Link
            href={`/bank/${bankId}/study-plan/create?edit=1`}
            className="inline-flex h-9 items-center gap-2 self-start rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit plan
          </Link>
        </div>
        <div className="mt-6 h-2 overflow-hidden rounded-full bg-[#ece7dc] dark:bg-slate-800">
          <div className="h-full rounded-full bg-[#b58a3d] transition-all" style={{ width: `${Math.min(100, Math.max(0, plan.progress))}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
          <span>{plan.progress}% complete</span>
          <span>{Math.max(0, plan.totalTopics - plan.completedTopics)} topics remaining</span>
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{error}</div>
      ) : null}

      {overdue.length > 0 ? (
        <section className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/60 dark:bg-amber-950/25 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 h-4 w-4 text-amber-700 dark:text-amber-300" />
            <div>
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">{overdue.length} overdue {overdue.length === 1 ? 'topic' : 'topics'}</p>
              <p className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-300/80">
                {plan.missedStrategy === 'next_free_day' ? 'Move them to the next empty study days; redistribute if none are available.' : 'Redistribute them across the remaining study days.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={rebalance}
            disabled={isPending}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-amber-900 px-3 text-xs font-semibold text-white disabled:opacity-60 dark:bg-amber-300 dark:text-amber-950"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isPending ? 'animate-spin' : ''}`} /> Rebalance
          </button>
        </section>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.55fr_0.75fr]">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-[#a17c35]" />
              <h2 className="text-sm font-semibold">Today&apos;s Plan</h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">{prettyDate(today)}</p>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
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
              <div className="px-5 py-9 text-center">
                <Check className="mx-auto h-6 w-6 text-emerald-500" />
                <p className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">No topics scheduled for today</p>
                <p className="mt-1 text-xs text-slate-500">Use the space to review, catch up, or take the day off.</p>
              </div>
            )}
          </div>
        </section>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <MetricCard label="Questions Practiced" value={plan.questionsPracticed.toLocaleString()} note="Across this question bank" icon={<Play className="h-4 w-4" />} />
          <MetricCard label="QBank Accuracy" value={`${plan.qbankAccuracy}%`} note="From your answered questions" icon={<Check className="h-4 w-4" />} />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <h2 className="text-sm font-semibold">Category progress</h2>
          <div className="mt-4 space-y-4">
            {plan.categories.map((category) => (
              <div key={category.category}>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium text-slate-700 dark:text-slate-200">{category.category}</span>
                  <span className="text-slate-400">{category.completed}/{category.total} topics</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className="h-full rounded-full bg-[#b58a3d]" style={{ width: `${Math.min(100, Math.max(0, category.progress))}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-[#a17c35]" /><h2 className="text-sm font-semibold">Calendar</h2></div>
            <span className="text-[11px] text-slate-400">Upcoming</span>
          </div>
          <div className="mt-4 space-y-3">
            {upcomingGroups.length > 0 ? upcomingGroups.map(([date, tasks]) => (
              <div key={date} className="flex gap-3 border-b border-slate-100 pb-3 last:border-0 dark:border-slate-800">
                <div className="w-20 shrink-0 text-xs font-semibold text-slate-500">{date === today ? 'Today' : prettyDate(date)}</div>
                <div className="min-w-0 space-y-1">
                  {tasks.slice(0, 3).map((task) => <p key={task.id} className="truncate text-xs text-slate-700 dark:text-slate-200">{task.topic}</p>)}
                  {tasks.length > 3 ? <p className="text-[11px] text-slate-400">+{tasks.length - 3} more</p> : null}
                </div>
              </div>
            )) : <p className="py-6 text-center text-xs text-slate-400">No upcoming topics.</p>}
          </div>
        </section>
      </div>
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
    <div className="px-5 py-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={`text-sm font-semibold ${completed ? 'text-slate-400 line-through' : 'text-slate-900 dark:text-white'}`}>{task.topic}</h3>
            {completed ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300">Completed</span> : null}
          </div>
          <p className="mt-1 text-xs text-slate-500">{task.category} · {task.questionCount.toLocaleString()} linked questions</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {task.articleId ? (
            <Link
              href={`/bank/${bankId}/textbook/high-yield?article=${encodeURIComponent(task.articleId)}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
            >
              <BookOpen className="h-3.5 w-3.5" /> Study Topic
            </Link>
          ) : null}
          {!completed ? (
            <>
              <button
                type="button"
                onClick={onStart}
                disabled={busy || task.questionCount <= 0}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#172238] px-3 text-[11px] font-semibold text-white hover:bg-[#24324f] disabled:opacity-50 dark:bg-[#d6b76b] dark:text-slate-950"
              >
                <Play className="h-3.5 w-3.5" /> {busy ? 'Starting…' : 'Create Session'}
              </button>
              <button
                type="button"
                onClick={onComplete}
                disabled={busy}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
              >
                <Check className="h-3.5 w-3.5" /> Mark Complete
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, note, icon }: { label: string; value: string; note: string; icon: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <div className="flex items-center gap-2 text-slate-400">{icon}<span className="text-[11px] font-semibold uppercase tracking-[0.12em]">{label}</span></div>
      <div className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-[#172238] dark:text-white">{value}</div>
      <p className="mt-1 text-[11px] text-slate-400">{note}</p>
    </section>
  );
}

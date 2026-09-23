'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  Check,
  CircleAlert,
  Pencil,
  Play,
  RefreshCw,
  Target,
} from 'lucide-react';
import {
  linkStudyPlanSessionAction,
  markStudyPlanTaskCompleteAction,
  rebalanceStudyPlanAction,
} from '@/actions/study-plan';
import { startExamSession } from '@/lib/exam-launch';
import { encodeTopicFilter } from '@/lib/topic-filters';
import type { ActiveStudyPlan, StudyPlanDashboard, StudyPlanTask } from '@/lib/study-plan';

const DAY_MS = 86_400_000;

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromKey(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

function addDays(value: string, amount: number): string {
  const date = dateFromKey(value);
  date.setDate(date.getDate() + amount);
  return localDateKey(date);
}

function prettyDate(value: string): string {
  return new Intl.DateTimeFormat('en', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(dateFromKey(value));
}

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(date);
}

function planStatusCopy(status: ActiveStudyPlan['status']) {
  if (status === 'behind') return { label: 'Behind', tone: 'danger' };
  if (status === 'ahead') return { label: 'Ahead', tone: 'success' };
  return { label: 'On track', tone: 'success' };
}

function mondayOfWeek(value: string): string {
  const date = dateFromKey(value);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return localDateKey(date);
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function buildCalendar(monthDate: Date): Array<{ key: string; day: number; currentMonth: boolean }> {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const first = new Date(year, month, 1, 12);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - mondayOffset, 12);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      key: localDateKey(date),
      day: date.getDate(),
      currentMonth: date.getMonth() === month,
    };
  });
}

function computeDayStreak(tasks: StudyPlanTask[], today: string): number {
  const byDate = new Map<string, StudyPlanTask[]>();
  for (const task of tasks) {
    if (task.scheduledDate > today) continue;
    const rows = byDate.get(task.scheduledDate) ?? [];
    rows.push(task);
    byDate.set(task.scheduledDate, rows);
  }

  let cursor = today;
  if ((byDate.get(cursor) ?? []).some((task) => task.status !== 'completed')) {
    cursor = addDays(cursor, -1);
  }

  let streak = 0;
  for (let guard = 0; guard < 365; guard += 1) {
    const rows = byDate.get(cursor);
    if (!rows || rows.length === 0 || rows.some((task) => task.status !== 'completed')) break;
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
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
      <div className="study-plan-premium study-plan-empty">
        <section className="sp-empty-card">
          <div>
            <span className="sp-kicker">Study Plan</span>
            <h1>Build a plan that finishes with you.</h1>
            <p>
              Royal schedules the bank by topic around your exam date, available study days and university commitments.
            </p>
            <div className="sp-empty-actions">
              <Link
                href={`/bank/${bankId}/study-plan/create`}
                aria-disabled={topicCount === 0}
                className={topicCount > 0 ? 'sp-primary-button' : 'sp-primary-button is-disabled'}
              >
                Create Study Plan
              </Link>
              <span>{topicCount.toLocaleString()} topics ready to schedule</span>
            </div>
          </div>
          <div className="sp-empty-note">
            <strong>Royal method</strong>
            <span>Plan by topic.</span>
            <span>Practice from the live QBank.</span>
            <span>Rebalance when life gets in the way.</span>
          </div>
        </section>
      </div>
    );
  }

  const today = localDateKey();
  const todayTasks = plan.tasks.filter((task) => task.scheduledDate === today);
  const visibleTodayTasks = todayTasks.slice(0, 3);
  const overdue = plan.tasks.filter((task) => task.status === 'pending' && task.scheduledDate < today);
  const status = planStatusCopy(plan.status);
  const remainingTopics = Math.max(0, plan.totalTopics - plan.completedTopics);
  const examDaysRemaining = Math.max(0, Math.ceil((dateFromKey(plan.examDate).getTime() - dateFromKey(today).getTime()) / DAY_MS));

  const totalBankQuestions =
    initialDashboard.catalog?.categories.reduce(
      (sum, category) => sum + category.topics.reduce((topicSum, topic) => topicSum + topic.questionCount, 0),
      0,
    ) ?? 0;
  const qbankRemaining = Math.max(0, totalBankQuestions - plan.questionsPracticed);
  const qbankRemainingPct = totalBankQuestions > 0 ? clampPercent((qbankRemaining / totalBankQuestions) * 100) : 0;

  const weekStart = mondayOfWeek(today);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const weekTasks = plan.tasks.filter((task) => task.scheduledDate >= weekStart && task.scheduledDate <= addDays(weekStart, 6));
  const weekCompleted = weekTasks.filter((task) => task.status === 'completed').length;
  const weeklyProgress = weekTasks.length > 0 ? clampPercent((weekCompleted / weekTasks.length) * 100) : 0;
  const dayStreak = computeDayStreak(plan.tasks, today);

  const monthDate = dateFromKey(today);
  const calendarDays = buildCalendar(monthDate);
  const taskMap = new Map<string, StudyPlanTask[]>();
  for (const task of plan.tasks) {
    const rows = taskMap.get(task.scheduledDate) ?? [];
    rows.push(task);
    taskMap.set(task.scheduledDate, rows);
  }

  const topCategories = [...plan.categories]
    .sort((a, b) => (b.total - b.completed) - (a.total - a.completed))
    .slice(0, 5);

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
    <div className="study-plan-premium">
      <header className="sp-page-header">
        <div>
          <h1>Study Plan</h1>
          <p><strong>MRCP Part 1</strong><span>•</span>Exam in <strong>{examDaysRemaining} days</strong></p>
        </div>
        <div className="sp-header-right">
          <blockquote>“A calmer mind. A brighter future.”</blockquote>
          <Link href={`/bank/${bankId}/study-plan/create?edit=1`} className="sp-edit-button">
            <Pencil aria-hidden="true" /> Edit plan
          </Link>
        </div>
      </header>

      <section className="sp-progress-card">
        <div className="sp-status-block">
          <Target aria-hidden="true" />
          <div>
            <span className="sp-eyebrow">Plan status</span>
            <span className={`sp-status-pill ${status.tone}`}>{status.label}</span>
            <small>Keep the pace steady.</small>
          </div>
        </div>

        <div className="sp-progress-block">
          <div className="sp-progress-row">
            <div className="sp-progress-copy">
              <span>Topics completed</span>
              <strong>{plan.completedTopics.toLocaleString()} <em>/ {plan.totalTopics.toLocaleString()}</em></strong>
            </div>
            <div className="sp-progress-track"><i style={{ width: `${clampPercent(plan.progress)}%` }} /></div>
            <b>{clampPercent(plan.progress)}%</b>
          </div>
          <div className="sp-progress-row secondary">
            <div className="sp-progress-copy">
              <span>Question bank remaining</span>
              <strong>{qbankRemaining.toLocaleString()} <em>questions</em></strong>
            </div>
            <div className="sp-progress-track"><i style={{ width: `${qbankRemainingPct}%` }} /></div>
            <b>{qbankRemainingPct}% remaining</b>
          </div>
        </div>

        <div className="sp-top-metrics">
          <Metric value={remainingTopics.toLocaleString()} label="Topics remaining" />
          <Metric value={todayTasks.filter((task) => task.status !== 'completed').length.toString()} label="Topics today" />
          <Metric value={examDaysRemaining.toString()} label="Days remaining" />
        </div>
      </section>

      {error ? <div className="sp-error">{error}</div> : null}

      {overdue.length > 0 ? (
        <div className="sp-overdue">
          <CircleAlert aria-hidden="true" />
          <span><strong>{overdue.length} overdue {overdue.length === 1 ? 'topic' : 'topics'}</strong> — rebalance them across your remaining study days.</span>
          <button type="button" onClick={rebalance} disabled={isPending}>
            <RefreshCw className={isPending ? 'spin' : ''} /> Rebalance
          </button>
        </div>
      ) : null}

      <div className="sp-primary-grid">
        <section className="sp-card sp-today-card">
          <div className="sp-card-head">
            <div>
              <h2>Today</h2>
              <p>{todayTasks.length} topics planned · Keep going.</p>
            </div>
            <span>{prettyDate(today)}</span>
          </div>

          <div className="sp-task-list">
            {visibleTodayTasks.length > 0 ? visibleTodayTasks.map((task) => (
              <TaskRow
                key={task.id}
                bankId={bankId}
                task={task}
                busy={isPending && busyTaskId === task.id}
                onStart={() => startTopicSession(task)}
                onComplete={() => markComplete(task)}
              />
            )) : (
              <div className="sp-empty-today">
                <Check />
                <strong>No topics scheduled today</strong>
                <span>Use the space to review or rest.</span>
              </div>
            )}
          </div>

          <div className="sp-card-foot">
            <span>{todayTasks.length > 3 ? `+${todayTasks.length - 3} more topic${todayTasks.length - 3 === 1 ? '' : 's'} today` : 'Stay consistent, not crowded.'}</span>
          </div>
        </section>

        <section className="sp-card sp-week-card">
          <div className="sp-card-head">
            <div>
              <h2>This Week</h2>
              <p>{weekTasks.length} topics · {weekDays.filter((day) => (taskMap.get(day) ?? []).length === 0).length} rest days</p>
            </div>
            <span>Week view</span>
          </div>

          <div className="sp-week-strip">
            {weekDays.map((day) => {
              const tasks = taskMap.get(day) ?? [];
              const completed = tasks.filter((task) => task.status === 'completed').length;
              return (
                <div key={day} className={`sp-week-day ${day === today ? 'today' : ''}`}>
                  <b>{new Intl.DateTimeFormat('en', { weekday: 'short' }).format(dateFromKey(day))}</b>
                  <span>{new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(dateFromKey(day))}</span>
                  <div className="sp-week-ring">
                    {tasks.length === 0 ? <i className="rest" /> : <i style={{ '--p': `${Math.round((completed / tasks.length) * 100)}%` } as CSSProperties} />}
                  </div>
                  <small>{tasks.length === 0 ? 'Rest' : `${completed}/${tasks.length}`}</small>
                </div>
              );
            })}
          </div>

          <div className="sp-week-stats">
            <MiniStat value={`${weekCompleted} / ${weekTasks.length}`} label="Topics this week" icon={<Target />} />
            <MiniStat value={`${weeklyProgress}%`} label="Weekly target" icon={<BarChart3 />} />
            <MiniStat value={dayStreak.toString()} label="Day streak" icon={<Check />} />
          </div>
          {overdue.length > 0 ? <div className="sp-week-overdue">{overdue.length} overdue topic{overdue.length === 1 ? '' : 's'}</div> : null}
        </section>
      </div>

      <div className="sp-secondary-grid">
        <section className="sp-card sp-subject-card">
          <div className="sp-card-head">
            <div>
              <h2>Subject Progress</h2>
              <p>Coverage across your plan.</p>
            </div>
            <span>Top priorities</span>
          </div>
          <div className="sp-subject-list">
            {topCategories.map((category) => (
              <div key={category.category} className="sp-subject-row">
                <span title={category.category}>{category.category}</span>
                <div className="sp-subject-track"><i style={{ width: `${clampPercent(category.progress)}%` }} /></div>
                <strong>{category.completed}/{category.total}</strong>
                <b>{clampPercent(category.progress)}%</b>
              </div>
            ))}
          </div>
        </section>

        <section className="sp-card sp-calendar-card">
          <div className="sp-card-head">
            <div>
              <h2>Schedule</h2>
              <p>Your study plan at a glance.</p>
            </div>
            <span>{monthLabel(monthDate)}</span>
          </div>

          <div className="sp-calendar">
            <div className="sp-calendar-weekdays">
              {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className="sp-calendar-grid">
              {calendarDays.map((cell) => {
                const tasks = taskMap.get(cell.key) ?? [];
                const allCompleted = tasks.length > 0 && tasks.every((task) => task.status === 'completed');
                const planned = tasks.length > 0 && !allCompleted;
                const inPlan = cell.key >= plan.startDate && cell.key < plan.examDate;
                const state = allCompleted ? 'completed' : planned ? 'planned' : inPlan ? 'rest' : 'none';
                return (
                  <div key={cell.key} className={`sp-calendar-day ${cell.currentMonth ? '' : 'muted'} ${cell.key === today ? 'selected' : ''}`}>
                    <span>{cell.day}</span>
                    <i className={state} />
                  </div>
                );
              })}
            </div>
            <div className="sp-calendar-legend">
              <span><i className="completed" />Completed</span>
              <span><i className="planned" />Planned</span>
              <span><i className="rest" />Rest day</span>
              <span><i className="none" />No study</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="sp-metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function MiniStat({ value, label, icon }: { value: string; label: string; icon: ReactNode }) {
  return (
    <div className="sp-mini-stat">
      {icon}
      <div><strong>{value}</strong><span>{label}</span></div>
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
    <div className={`sp-task-row ${completed ? 'completed' : ''}`}>
      <button
        type="button"
        className="sp-task-check"
        aria-label={completed ? 'Topic completed' : `Mark ${task.topic} complete`}
        onClick={completed ? undefined : onComplete}
        disabled={completed || busy}
      >
        {completed ? <Check /> : null}
      </button>

      <div className="sp-task-main">
        <strong>{task.topic}</strong>
        <div><span>{task.category}</span><small>{task.questionCount.toLocaleString()} questions</small></div>
      </div>

      <div className="sp-task-actions">
        {task.articleId ? (
          <Link
            href={`/bank/${bankId}/textbook/high-yield/${encodeURIComponent(task.articleId)}`}
            className="sp-study-button"
          >
            <BookOpen /> Study
          </Link>
        ) : (
          <button className="sp-study-button" type="button" disabled><BookOpen /> Study</button>
        )}

        {!completed ? (
          <button
            type="button"
            className="sp-practice-button"
            onClick={onStart}
            disabled={busy || task.questionCount <= 0}
          >
            <Play /> {busy ? 'Starting…' : 'Practice'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

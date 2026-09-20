import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { readStaticStudyPlanCatalog } from '@/lib/ui-static-r2';

export type StudyPlanMissedStrategy = 'next_free_day' | 'redistribute';
export type StudyPlanPeriodMode = 'pause' | 'reduced';
export type StudyPlanStatus = 'on_track' | 'ahead' | 'behind';
export type StudyPlanTaskStatus = 'pending' | 'completed';

export interface StudyPlanPeriodInput {
  startDate: string;
  endDate: string;
  mode: StudyPlanPeriodMode;
}

export interface StudyPlanCategoryPriorityInput {
  category: string;
  priority: number;
}

export interface StudyPlanSettingsInput {
  startDate: string;
  examDate: string;
  studyWeekdays: number[];
  missedStrategy: StudyPlanMissedStrategy;
  reducedLoadFactor: number;
  periods: StudyPlanPeriodInput[];
  categoryPriorities: StudyPlanCategoryPriorityInput[];
}

export interface StudyPlanCatalogTopic {
  id: number;
  name: string;
  questionCount: number;
  articleId: string | null;
}

export interface StudyPlanCatalogCategory {
  name: string;
  topicCount: number;
  topics: StudyPlanCatalogTopic[];
}

export interface StudyPlanCatalog {
  bankId: number;
  topicCount: number;
  categories: StudyPlanCatalogCategory[];
}

export interface StudyPlanExamFilter {
  category: string;
  topic: string;
}

export interface StudyPlanTask {
  id: number;
  topicId: number;
  topic: string;
  category: string;
  scheduledDate: string;
  status: StudyPlanTaskStatus;
  completedAt: string | null;
  questionCount: number;
  articleId: string | null;
  examFilters: StudyPlanExamFilter[];
  sessionId: string | null;
}

export interface StudyPlanCategoryProgress {
  category: string;
  priority: number;
  total: number;
  completed: number;
  progress: number;
}

export interface StudyPlanPeriod extends StudyPlanPeriodInput {
  id: number;
}

export interface ActiveStudyPlan {
  id: string;
  startDate: string;
  examDate: string;
  studyWeekdays: number[];
  missedStrategy: StudyPlanMissedStrategy;
  reducedLoadFactor: number;
  status: StudyPlanStatus;
  totalTopics: number;
  completedTopics: number;
  progress: number;
  questionsPracticed: number;
  qbankAccuracy: number;
  periods: StudyPlanPeriod[];
  categories: StudyPlanCategoryProgress[];
  tasks: StudyPlanTask[];
}

export interface StudyPlanDashboard {
  bankId: number;
  plan: ActiveStudyPlan | null;
  catalog: StudyPlanCatalog | null;
}

export class StudyPlanAuthenticationError extends Error {
  constructor() {
    super('Authentication required');
    this.name = 'StudyPlanAuthenticationError';
  }
}

export class StudyPlanAccessError extends Error {
  constructor(message = 'Question bank access denied') {
    super(message);
    this.name = 'StudyPlanAccessError';
  }
}

export class StudyPlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StudyPlanValidationError';
  }
}

function classifyError(message?: string): Error {
  const value = message ?? '';
  if (/authentication required/i.test(value)) return new StudyPlanAuthenticationError();
  if (/access denied/i.test(value)) return new StudyPlanAccessError();
  if (/STUDY_PLAN_/i.test(value)) return new StudyPlanValidationError(value);
  return new StudyPlanAccessError();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function parseCatalog(payload: unknown, fallbackBankId: number): StudyPlanCatalog {
  const row = asRecord(payload);
  return {
    bankId: asNumber(row.bank_id, fallbackBankId),
    topicCount: asNumber(row.topic_count),
    categories: asArray(row.categories).map((item) => {
      const category = asRecord(item);
      return {
        name: asString(category.name, 'General'),
        topicCount: asNumber(category.topic_count),
        topics: asArray(category.topics).map((topicItem) => {
          const topic = asRecord(topicItem);
          return {
            id: asNumber(topic.id),
            name: asString(topic.name),
            questionCount: asNumber(topic.question_count),
            articleId: asNullableString(topic.article_id),
          };
        }),
      };
    }),
  };
}

function parseTask(value: unknown): StudyPlanTask {
  const row = asRecord(value);
  return {
    id: asNumber(row.id),
    topicId: asNumber(row.topic_id),
    topic: asString(row.topic),
    category: asString(row.category, 'General'),
    scheduledDate: asString(row.scheduled_date),
    status: row.status === 'completed' ? 'completed' : 'pending',
    completedAt: asNullableString(row.completed_at),
    questionCount: asNumber(row.question_count),
    articleId: asNullableString(row.article_id),
    examFilters: asArray(row.exam_filters).flatMap((filterValue) => {
      const filter = asRecord(filterValue);
      const category = asString(filter.category);
      const topic = asString(filter.topic);
      return category && topic ? [{ category, topic }] : [];
    }),
    sessionId: asNullableString(row.session_id),
  };
}

function parsePlan(value: unknown): ActiveStudyPlan | null {
  if (!value) return null;
  const row = asRecord(value);
  const id = asString(row.id);
  if (!id) return null;

  const missedStrategy: StudyPlanMissedStrategy =
    row.missed_strategy === 'next_free_day' ? 'next_free_day' : 'redistribute';
  const status: StudyPlanStatus =
    row.status === 'behind' ? 'behind' : row.status === 'ahead' ? 'ahead' : 'on_track';

  return {
    id,
    startDate: asString(row.start_date),
    examDate: asString(row.exam_date),
    studyWeekdays: asArray(row.study_weekdays).map((day) => asNumber(day)),
    missedStrategy,
    reducedLoadFactor: asNumber(row.reduced_load_factor, 0.5),
    status,
    totalTopics: asNumber(row.total_topics),
    completedTopics: asNumber(row.completed_topics),
    progress: asNumber(row.progress),
    questionsPracticed: asNumber(row.questions_practiced),
    qbankAccuracy: asNumber(row.qbank_accuracy),
    periods: asArray(row.periods).map((periodValue) => {
      const period = asRecord(periodValue);
      return {
        id: asNumber(period.id),
        startDate: asString(period.start_date),
        endDate: asString(period.end_date),
        mode: period.mode === 'pause' ? 'pause' : 'reduced',
      };
    }),
    categories: asArray(row.categories).map((categoryValue) => {
      const category = asRecord(categoryValue);
      return {
        category: asString(category.category, 'General'),
        priority: asNumber(category.priority, 100000),
        total: asNumber(category.total),
        completed: asNumber(category.completed),
        progress: asNumber(category.progress),
      };
    }),
    tasks: asArray(row.tasks).map(parseTask),
  };
}

async function rpcClient() {
  // Study Plan RPCs enforce auth/access themselves. Avoid a separate
  // auth.getUser() request before every read/write.
  return createClient();
}

async function getCatalogWithFallback(
  supabase: Awaited<ReturnType<typeof rpcClient>>,
  bankId: number,
  staticCatalog: Awaited<ReturnType<typeof readStaticStudyPlanCatalog>>,
): Promise<StudyPlanCatalog> {
  if (staticCatalog) return parseCatalog(staticCatalog, bankId);

  const { data, error } = await supabase.rpc('get_study_plan_catalog', { p_bank_id: bankId });
  if (error) throw classifyError(error.message);
  return parseCatalog(data, bankId);
}

export async function getStudyPlanPageData(bankId: number): Promise<{
  dashboard: StudyPlanDashboard;
  catalog: StudyPlanCatalog;
}> {
  const supabase = await rpcClient();
  const [dashboardResult, staticCatalog] = await Promise.all([
    supabase.rpc('get_study_plan_dashboard_light', { p_bank_id: bankId }),
    readStaticStudyPlanCatalog(bankId),
  ]);

  if (dashboardResult.error) throw classifyError(dashboardResult.error.message);
  const payload = asRecord(dashboardResult.data);
  const catalog = await getCatalogWithFallback(supabase, bankId, staticCatalog);

  return {
    dashboard: {
      bankId: asNumber(payload.bank_id, bankId),
      plan: parsePlan(payload.plan),
      catalog,
    },
    catalog,
  };
}

export async function getStudyPlanCatalog(bankId: number): Promise<StudyPlanCatalog> {
  return (await getStudyPlanPageData(bankId)).catalog;
}

export async function getStudyPlanDashboard(bankId: number): Promise<StudyPlanDashboard> {
  return (await getStudyPlanPageData(bankId)).dashboard;
}

function periodsToRpc(periods: StudyPlanPeriodInput[]) {
  return periods.map((period) => ({
    start_date: period.startDate,
    end_date: period.endDate,
    mode: period.mode,
  }));
}

function prioritiesToRpc(priorities: StudyPlanCategoryPriorityInput[]) {
  return priorities.map((priority) => ({
    category: priority.category,
    priority: priority.priority,
  }));
}

export async function createStudyPlanRecord(
  bankId: number,
  input: StudyPlanSettingsInput,
): Promise<string> {
  const supabase = await rpcClient();
  const { data, error } = await supabase.rpc('create_study_plan', {
    p_bank_id: bankId,
    p_start_date: input.startDate,
    p_exam_date: input.examDate,
    p_study_weekdays: input.studyWeekdays,
    p_missed_strategy: input.missedStrategy,
    p_reduced_load_factor: input.reducedLoadFactor,
    p_periods: periodsToRpc(input.periods),
    p_category_priorities: prioritiesToRpc(input.categoryPriorities),
  });
  if (error) throw classifyError(error.message);
  if (typeof data !== 'string') throw new StudyPlanValidationError('STUDY_PLAN_CREATE_FAILED');
  return data;
}

export async function updateStudyPlanRecord(
  planId: string,
  input: StudyPlanSettingsInput,
): Promise<void> {
  const supabase = await rpcClient();
  const { error } = await supabase.rpc('update_study_plan', {
    p_plan_id: planId,
    p_start_date: input.startDate,
    p_exam_date: input.examDate,
    p_study_weekdays: input.studyWeekdays,
    p_missed_strategy: input.missedStrategy,
    p_reduced_load_factor: input.reducedLoadFactor,
    p_periods: periodsToRpc(input.periods),
    p_category_priorities: prioritiesToRpc(input.categoryPriorities),
  });
  if (error) throw classifyError(error.message);
}

export async function completeStudyPlanTask(taskId: number): Promise<void> {
  const supabase = await rpcClient();
  const { error } = await supabase.rpc('mark_study_plan_task_complete', { p_task_id: taskId });
  if (error) throw classifyError(error.message);
}

export async function linkStudyPlanSession(taskId: number, sessionId: string): Promise<void> {
  const supabase = await rpcClient();
  const { error } = await supabase.rpc('link_study_plan_session', {
    p_task_id: taskId,
    p_session_id: sessionId,
  });
  if (error) throw classifyError(error.message);
}

export async function rebalanceStudyPlanRecord(
  planId: string,
  strategy?: StudyPlanMissedStrategy,
): Promise<{ strategy: StudyPlanMissedStrategy; moved: number; fallback: boolean }> {
  const supabase = await rpcClient();
  const { data, error } = await supabase.rpc('rebalance_study_plan', {
    p_plan_id: planId,
    p_strategy: strategy ?? null,
  });
  if (error) throw classifyError(error.message);
  const payload = asRecord(data);
  return {
    strategy: payload.strategy === 'next_free_day' ? 'next_free_day' : 'redistribute',
    moved: asNumber(payload.moved),
    fallback: payload.fallback === true,
  };
}

'use server';

import { createClient } from '@/lib/supabase/server';
import { readStaticCatalogRows } from '@/lib/ui-static-r2';
import type { AccessResolution } from '@/types/catalog';

export interface ActiveAccessGrant {
  id: number;
  scope_type: 'global' | 'pathway' | 'bank';
  pathway_id: number | null;
  question_bank_id: number | null;
  starts_at: string;
  expires_at: string | null;
  created_at: string;
}

export type CommerceLockReason = 'subscription' | 'request' | null;

export interface QuestionBankItem {
  id: number;
  pathwayId: number;
  name: string;
  description: string;
  questionCount: number;
  textbookArticleCount: number;
  isFreeTrialAvailable: boolean;
  freeTrialBlockLimit: number;
  freeTrialQuestionLimit: number;
  freeTrialArticleLimit: number;
  isUnlocked: boolean;
  hasPremiumAccess: boolean;
  accessState: AccessResolution;
  catalogAvailable: boolean;
}

export interface PathwayDetail {
  id: number;
  slug: string;
  name: string;
  description: string;
  iconUrl: string | null;
  totalQuestions: number;
  isFreeTrialAvailable: boolean;
  isUnlocked: boolean;
  hasFullAccess: boolean;
  accessState: AccessResolution;
  catalogAvailable: boolean;
  commerceLocked: boolean;
  commerceLockReason: CommerceLockReason;
  activeAccess: ActiveAccessGrant[];
  banks: QuestionBankItem[];
}

export interface GlobalCatalogState {
  accessState: AccessResolution;
  catalogAvailable: boolean;
  commerceLocked: boolean;
  commerceLockReason: CommerceLockReason;
}

interface PathwayRow {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  icon_url: string | null;
  is_free_trial_available: boolean | null;
  display_order: number | null;
}

interface BankRow {
  id: number;
  pathway_id: number;
  name: string;
  description: string | null;
  display_order: number | null;
  is_free_trial: boolean | null;
  free_trial_block_limit: number | null;
  free_trial_question_limit: number | null;
  free_trial_article_limit: number | null;
}

interface OverviewPathway {
  id: number;
  access: AccessResolution;
  catalog_available: boolean;
}

interface OverviewBank {
  id: number;
  access: AccessResolution;
  catalog_available: boolean;
  unlocked: boolean;
  question_count: number;
  article_count: number;
}

interface CatalogOverview {
  global: {
    access: AccessResolution;
    catalog_available: boolean;
  };
  pathways: OverviewPathway[];
  banks: OverviewBank[];
  active_access: ActiveAccessGrant[];
  commerce_locked: boolean;
  commerce_lock_reason: CommerceLockReason;
}

const emptyAccess: AccessResolution = {
  has_access: false,
  coverage_kind: 'none',
  can_extend: false,
  expires_soon: false,
  grant_id: null,
  scope_type: null,
  pathway_id: null,
  question_bank_id: null,
  starts_at: null,
  expires_at: null,
  is_lifetime: false,
};

const emptyOverview: CatalogOverview = {
  global: { access: emptyAccess, catalog_available: false },
  pathways: [],
  banks: [],
  active_access: [],
  commerce_locked: false,
  commerce_lock_reason: null,
};

type CatalogRows = {
  pathways: PathwayRow[];
  banks: BankRow[];
};

const CATALOG_ROWS_MEMORY_TTL_MS = 10 * 60 * 1000;
let catalogRowsMemoryCache: { value: CatalogRows; expiresAt: number } | null = null;
let catalogRowsInFlight: Promise<CatalogRows> | null = null;

async function loadCatalogRowsFromSupabase(): Promise<CatalogRows> {
  const supabase = await createClient();
  const [pathwaysResult, banksResult] = await Promise.all([
    supabase
      .from('pathways')
      .select('id, slug, name, description, icon_url, is_free_trial_available, display_order')
      .order('display_order', { ascending: true })
      .order('id', { ascending: true }),
    supabase
      .from('question_banks')
      .select('id, pathway_id, name, description, display_order, is_free_trial, free_trial_block_limit, free_trial_question_limit, free_trial_article_limit')
      .order('display_order', { ascending: true })
      .order('id', { ascending: true }),
  ]);

  if (pathwaysResult.error) throw pathwaysResult.error;
  if (banksResult.error) throw banksResult.error;

  return {
    pathways: (pathwaysResult.data || []) as PathwayRow[],
    banks: (banksResult.data || []) as BankRow[],
  };
}

async function loadCatalogRows(): Promise<CatalogRows> {
  const now = Date.now();
  if (catalogRowsMemoryCache && catalogRowsMemoryCache.expiresAt > now) {
    return catalogRowsMemoryCache.value;
  }
  if (catalogRowsInFlight) return catalogRowsInFlight;

  const request = (async () => {
    const r2 = await readStaticCatalogRows();
    const value: CatalogRows = r2
      ? {
          pathways: r2.pathways as PathwayRow[],
          banks: r2.banks as BankRow[],
        }
      : await loadCatalogRowsFromSupabase();

    catalogRowsMemoryCache = {
      value,
      expiresAt: Date.now() + CATALOG_ROWS_MEMORY_TTL_MS,
    };
    return value;
  })().finally(() => {
    if (catalogRowsInFlight === request) catalogRowsInFlight = null;
  });

  catalogRowsInFlight = request;
  return request;
}

async function loadCatalogOverview(): Promise<CatalogOverview> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_my_catalog_overview');
  if (error || !data) return emptyOverview;
  return data as CatalogOverview;
}

function buildPathway(pathway: PathwayRow, bankRows: BankRow[], overview: CatalogOverview): PathwayDetail {
  const matchingBanks = bankRows
    .filter((bank) => bank.pathway_id === pathway.id)
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || a.id - b.id);

  const overviewBanks = new Map(overview.banks.map((bank) => [bank.id, bank]));
  const pathwayState = overview.pathways.find((item) => item.id === pathway.id);

  const banks: QuestionBankItem[] = matchingBanks.map((bank) => {
    const state = overviewBanks.get(bank.id);
    const access = state?.access || emptyAccess;
    return {
      id: bank.id,
      pathwayId: bank.pathway_id,
      name: bank.name,
      description: bank.description || '',
      questionCount: Number(state?.question_count || 0),
      textbookArticleCount: Number(state?.article_count || 0),
      isFreeTrialAvailable: bank.is_free_trial === true,
      freeTrialBlockLimit: bank.free_trial_block_limit ?? 0,
      freeTrialQuestionLimit: bank.free_trial_question_limit ?? 0,
      freeTrialArticleLimit: bank.free_trial_article_limit ?? 0,
      isUnlocked: state?.unlocked === true,
      hasPremiumAccess: access.has_access,
      accessState: access,
      catalogAvailable: state?.catalog_available === true,
    };
  });

  const bankIds = new Set(banks.map((bank) => bank.id));
  const activeAccess = overview.active_access.filter((grant) =>
    grant.scope_type === 'global'
    || (grant.scope_type === 'pathway' && grant.pathway_id === pathway.id)
    || (grant.scope_type === 'bank' && grant.question_bank_id !== null && bankIds.has(grant.question_bank_id)),
  );
  const accessState = pathwayState?.access || emptyAccess;

  return {
    id: pathway.id,
    slug: pathway.slug,
    name: pathway.name,
    description: pathway.description || '',
    iconUrl: pathway.icon_url,
    totalQuestions: banks.reduce((sum, bank) => sum + bank.questionCount, 0),
    isFreeTrialAvailable: pathway.is_free_trial_available === true,
    isUnlocked: banks.some((bank) => bank.isUnlocked),
    hasFullAccess: accessState.has_access,
    accessState,
    catalogAvailable: pathwayState?.catalog_available === true,
    commerceLocked: overview.commerce_locked === true,
    commerceLockReason: overview.commerce_lock_reason || null,
    activeAccess,
    banks,
  };
}

export async function getCatalogPathways(): Promise<PathwayDetail[]> {
  const [{ pathways, banks }, overview] = await Promise.all([loadCatalogRows(), loadCatalogOverview()]);
  return pathways.map((pathway) => buildPathway(pathway, banks, overview));
}

export async function getPathwayDetails(slug: string): Promise<PathwayDetail | null> {
  const [{ pathways, banks }, overview] = await Promise.all([loadCatalogRows(), loadCatalogOverview()]);
  const pathway = pathways.find((candidate) => candidate.slug === slug);
  if (!pathway) return null;
  return buildPathway(pathway, banks, overview);
}

export async function getBankDetails(bankId: number): Promise<QuestionBankItem | null> {
  const [{ pathways, banks }, overview] = await Promise.all([loadCatalogRows(), loadCatalogOverview()]);
  const bank = banks.find((candidate) => candidate.id === bankId);
  if (!bank) return null;
  const pathway = pathways.find((candidate) => candidate.id === bank.pathway_id);
  if (!pathway) return null;
  return buildPathway(pathway, [bank], overview).banks[0] ?? null;
}

export async function getGlobalCatalogState(): Promise<GlobalCatalogState> {
  const overview = await loadCatalogOverview();
  return {
    accessState: overview.global?.access || emptyAccess,
    catalogAvailable: overview.global?.catalog_available === true,
    commerceLocked: overview.commerce_locked === true,
    commerceLockReason: overview.commerce_lock_reason || null,
  };
}

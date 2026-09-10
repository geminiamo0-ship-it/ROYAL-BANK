'use server';

import { createClient } from '@/lib/supabase/server';
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
  activeAccess: ActiveAccessGrant[];
  banks: QuestionBankItem[];
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

interface ResolvedBankAccess {
  unlocked: boolean;
  accessState: AccessResolution;
  catalogAvailable: boolean;
}

async function resolveBankAccess(bankIds: number[]): Promise<{
  access: Map<number, ResolvedBankAccess>;
  grants: ActiveAccessGrant[];
}> {
  const access = new Map<number, ResolvedBankAccess>(
    bankIds.map((id) => [id, { unlocked: false, accessState: emptyAccess, catalogAvailable: false }]),
  );

  if (bankIds.length === 0) return { access, grants: [] };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { access, grants: [] };

  const grantsPromise = supabase.rpc('get_my_active_access_grants');

  await Promise.all(
    bankIds.map(async (bankId) => {
      const [contentResult, accessResult, offerResult] = await Promise.all([
        supabase.rpc('can_access_question_bank', { p_bank_id: bankId }),
        supabase.rpc('resolve_my_access', {
          p_scope_type: 'bank',
          p_pathway_id: null,
          p_bank_id: bankId,
        }),
        supabase.rpc('get_catalog_upgrade_offer', { p_scope_type: 'bank', p_target_id: bankId }),
      ]);

      access.set(bankId, {
        unlocked: !contentResult.error && contentResult.data === true,
        accessState: accessResult.error ? emptyAccess : (accessResult.data as AccessResolution),
        catalogAvailable: !offerResult.error && Boolean(offerResult.data),
      });
    }),
  );

  const grantsResult = await grantsPromise;
  return {
    access,
    grants: grantsResult.error ? [] : ((grantsResult.data || []) as ActiveAccessGrant[]),
  };
}

async function resolvePathwayState(pathwayId: number): Promise<{ access: AccessResolution; catalogAvailable: boolean }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { access: emptyAccess, catalogAvailable: false };
  const [accessResult, offerResult] = await Promise.all([
    supabase.rpc('resolve_my_access', {
      p_scope_type: 'pathway',
      p_pathway_id: pathwayId,
      p_bank_id: null,
    }),
    supabase.rpc('get_catalog_upgrade_offer', { p_scope_type: 'pathway', p_target_id: pathwayId }),
  ]);
  return {
    access: accessResult.error || !accessResult.data ? emptyAccess : (accessResult.data as AccessResolution),
    catalogAvailable: !offerResult.error && Boolean(offerResult.data),
  };
}

async function countBankContent(bankId: number) {
  const supabase = await createClient();
  const [questionResult, articleResult] = await Promise.all([
    supabase
      .from('question_bank_questions')
      .select('question_id', { count: 'exact', head: true })
      .eq('question_bank_id', bankId),
    supabase
      .from('question_bank_library_articles')
      .select('article_id', { count: 'exact', head: true })
      .eq('question_bank_id', bankId),
  ]);

  return {
    questionCount: questionResult.error ? 0 : questionResult.count ?? 0,
    textbookArticleCount: articleResult.error ? 0 : articleResult.count ?? 0,
  };
}

async function buildPathway(pathway: PathwayRow, bankRows: BankRow[]): Promise<PathwayDetail> {
  const matchingBanks = bankRows
    .filter((bank) => bank.pathway_id === pathway.id)
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || a.id - b.id);

  const [resolved, counts, pathwayAccess] = await Promise.all([
    resolveBankAccess(matchingBanks.map((bank) => bank.id)),
    Promise.all(matchingBanks.map((bank) => countBankContent(bank.id))),
    resolvePathwayState(pathway.id),
  ]);

  const banks: QuestionBankItem[] = matchingBanks.map((bank, index) => {
    const bankState = resolved.access.get(bank.id);
    const bankAccess = bankState?.accessState || emptyAccess;
    return {
      id: bank.id,
      pathwayId: bank.pathway_id,
      name: bank.name,
      description: bank.description || '',
      questionCount: counts[index]?.questionCount ?? 0,
      textbookArticleCount: counts[index]?.textbookArticleCount ?? 0,
      isFreeTrialAvailable: bank.is_free_trial === true,
      freeTrialBlockLimit: bank.free_trial_block_limit ?? 0,
      freeTrialQuestionLimit: bank.free_trial_question_limit ?? 0,
      freeTrialArticleLimit: bank.free_trial_article_limit ?? 0,
      isUnlocked: resolved.access.get(bank.id)?.unlocked === true,
      hasPremiumAccess: bankAccess.has_access,
      accessState: bankAccess,
      catalogAvailable: bankState?.catalogAvailable === true,
    };
  });

  const bankIds = new Set(banks.map((bank) => bank.id));
  const activeAccess = resolved.grants.filter((grant) =>
    grant.scope_type === 'global'
    || (grant.scope_type === 'pathway' && grant.pathway_id === pathway.id)
    || (grant.scope_type === 'bank' && grant.question_bank_id !== null && bankIds.has(grant.question_bank_id)),
  );

  return {
    id: pathway.id,
    slug: pathway.slug,
    name: pathway.name,
    description: pathway.description || '',
    iconUrl: pathway.icon_url,
    totalQuestions: banks.reduce((sum, bank) => sum + bank.questionCount, 0),
    isFreeTrialAvailable: pathway.is_free_trial_available === true,
    isUnlocked: banks.some((bank) => bank.isUnlocked),
    hasFullAccess: pathwayAccess.access.has_access,
    accessState: pathwayAccess.access,
    catalogAvailable: pathwayAccess.catalogAvailable,
    activeAccess,
    banks,
  };
}

async function loadCatalogRows() {
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

export async function getCatalogPathways(): Promise<PathwayDetail[]> {
  const { pathways, banks } = await loadCatalogRows();
  return Promise.all(pathways.map((pathway) => buildPathway(pathway, banks)));
}

export async function getPathwayDetails(slug: string): Promise<PathwayDetail | null> {
  const { pathways, banks } = await loadCatalogRows();
  const pathway = pathways.find((candidate) => candidate.slug === slug);
  if (!pathway) return null;
  return buildPathway(pathway, banks);
}

export async function getBankDetails(bankId: number): Promise<QuestionBankItem | null> {
  const { pathways, banks } = await loadCatalogRows();
  const bank = banks.find((candidate) => candidate.id === bankId);
  if (!bank) return null;
  const pathway = pathways.find((candidate) => candidate.id === bank.pathway_id);
  if (!pathway) return null;
  const detail = await buildPathway(pathway, [bank]);
  return detail.banks[0] ?? null;
}

'use server';

import { createClient } from '@/lib/supabase/server';

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
  pathwayName: string;
  pathwaySlug: string;
  name: string;
  description: string;
  questionCount: number;
  textbookArticleCount: number;
  isFreeTrialAvailable: boolean;
  freeTrialBlockLimit: number | null;
  freeTrialQuestionLimit: number;
  freeTrialArticleLimit: number;
  isUnlocked: boolean;
  hasPremiumAccess: boolean;
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
  activeAccess: ActiveAccessGrant[];
  banks: QuestionBankItem[];
}

type PathwayRow = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  icon_url: string | null;
  is_free_trial_available: boolean;
};

type BankRow = {
  id: number;
  pathway_id: number;
  name: string;
  description: string | null;
  is_free_trial: boolean;
  free_trial_block_limit: number | null;
  free_trial_question_limit: number;
  free_trial_article_limit: number;
};

interface ResolvedBankAccess {
  unlocked: boolean;
  premium: boolean;
}

async function resolveBankAccess(bankIds: number[]): Promise<{
  access: Map<number, ResolvedBankAccess>;
  grants: ActiveAccessGrant[];
}> {
  const access = new Map<number, ResolvedBankAccess>(
    bankIds.map((id) => [id, { unlocked: false, premium: false }]),
  );

  if (bankIds.length === 0) return { access, grants: [] };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { access, grants: [] };

  const grantsPromise = supabase.rpc('get_my_active_access_grants');
  await Promise.all(
    bankIds.map(async (bankId) => {
      const [contentResult, premiumResult] = await Promise.all([
        supabase.rpc('can_access_question_bank', { p_bank_id: bankId }),
        supabase.rpc('has_premium_question_bank_access', { p_bank_id: bankId }),
      ]);

      if (contentResult.error) throw new Error(contentResult.error.message);
      if (premiumResult.error) throw new Error(premiumResult.error.message);

      access.set(bankId, {
        unlocked: contentResult.data === true,
        premium: premiumResult.data === true,
      });
    }),
  );

  const grantsResult = await grantsPromise;
  if (grantsResult.error) throw new Error(grantsResult.error.message);

  return {
    access,
    grants: (grantsResult.data || []) as ActiveAccessGrant[],
  };
}

async function getBankCounts(bankId: number) {
  const supabase = await createClient();
  const [questionsResult, articlesResult] = await Promise.all([
    supabase
      .from('question_bank_questions')
      .select('question_id', { count: 'exact', head: true })
      .eq('question_bank_id', bankId),
    supabase
      .from('question_bank_library_articles')
      .select('article_id', { count: 'exact', head: true })
      .eq('question_bank_id', bankId),
  ]);

  if (questionsResult.error) throw new Error(questionsResult.error.message);
  if (articlesResult.error) throw new Error(articlesResult.error.message);

  return {
    questionCount: questionsResult.count || 0,
    textbookArticleCount: articlesResult.count || 0,
  };
}

async function hydratePathway(pathway: PathwayRow): Promise<PathwayDetail> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('question_banks')
    .select(
      'id,pathway_id,name,description,is_free_trial,free_trial_block_limit,free_trial_question_limit,free_trial_article_limit',
    )
    .eq('pathway_id', pathway.id)
    .order('display_order', { ascending: true })
    .order('id', { ascending: true });

  if (error) throw new Error(error.message);

  const bankRows = (data || []) as BankRow[];
  const [resolved, counts] = await Promise.all([
    resolveBankAccess(bankRows.map((bank) => bank.id)),
    Promise.all(bankRows.map((bank) => getBankCounts(bank.id))),
  ]);

  const banks: QuestionBankItem[] = bankRows.map((bank, index) => ({
    id: bank.id,
    pathwayId: bank.pathway_id,
    pathwayName: pathway.name,
    pathwaySlug: pathway.slug,
    name: bank.name,
    description: bank.description || '',
    questionCount: counts[index].questionCount,
    textbookArticleCount: counts[index].textbookArticleCount,
    isFreeTrialAvailable: bank.is_free_trial,
    freeTrialBlockLimit: bank.free_trial_block_limit,
    freeTrialQuestionLimit: bank.free_trial_question_limit,
    freeTrialArticleLimit: bank.free_trial_article_limit,
    isUnlocked: resolved.access.get(bank.id)?.unlocked === true,
    hasPremiumAccess: resolved.access.get(bank.id)?.premium === true,
  }));

  const bankIds = new Set(banks.map((bank) => bank.id));
  const activeAccess = resolved.grants.filter(
    (grant) =>
      grant.scope_type === 'global' ||
      (grant.scope_type === 'pathway' && grant.pathway_id === pathway.id) ||
      (grant.scope_type === 'bank' &&
        grant.question_bank_id !== null &&
        bankIds.has(grant.question_bank_id)),
  );
  const directFullGrant = activeAccess.some(
    (grant) =>
      grant.scope_type === 'global' ||
      (grant.scope_type === 'pathway' && grant.pathway_id === pathway.id),
  );

  return {
    id: pathway.id,
    slug: pathway.slug,
    name: pathway.name,
    description: pathway.description || '',
    iconUrl: pathway.icon_url,
    totalQuestions: banks.reduce((sum, bank) => sum + bank.questionCount, 0),
    isFreeTrialAvailable: pathway.is_free_trial_available,
    isUnlocked: banks.some((bank) => bank.isUnlocked),
    hasFullAccess:
      directFullGrant || (banks.length > 0 && banks.every((bank) => bank.hasPremiumAccess)),
    activeAccess,
    banks,
  };
}

export async function getCatalogPathways(): Promise<PathwayDetail[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('pathways')
    .select('id,slug,name,description,icon_url,is_free_trial_available')
    .order('display_order', { ascending: true })
    .order('id', { ascending: true });

  if (error) throw new Error(error.message);

  return Promise.all(((data || []) as PathwayRow[]).map(hydratePathway));
}

export async function getPathwayDetails(slug: string): Promise<PathwayDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('pathways')
    .select('id,slug,name,description,icon_url,is_free_trial_available')
    .eq('slug', slug)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  return hydratePathway(data as PathwayRow);
}

export async function getBankDetails(bankId: number): Promise<QuestionBankItem | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('question_banks')
    .select(
      'id,pathway_id,name,description,is_free_trial,free_trial_block_limit,free_trial_question_limit,free_trial_article_limit',
    )
    .eq('id', bankId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const bank = data as BankRow;
  const { data: pathwayData, error: pathwayError } = await supabase
    .from('pathways')
    .select('id,slug,name')
    .eq('id', bank.pathway_id)
    .single();

  if (pathwayError) throw new Error(pathwayError.message);

  const [resolved, counts] = await Promise.all([
    resolveBankAccess([bankId]),
    getBankCounts(bankId),
  ]);

  return {
    id: bank.id,
    pathwayId: bank.pathway_id,
    pathwayName: pathwayData.name,
    pathwaySlug: pathwayData.slug,
    name: bank.name,
    description: bank.description || '',
    questionCount: counts.questionCount,
    textbookArticleCount: counts.textbookArticleCount,
    isFreeTrialAvailable: bank.is_free_trial,
    freeTrialBlockLimit: bank.free_trial_block_limit,
    freeTrialQuestionLimit: bank.free_trial_question_limit,
    freeTrialArticleLimit: bank.free_trial_article_limit,
    isUnlocked: resolved.access.get(bankId)?.unlocked === true,
    hasPremiumAccess: resolved.access.get(bankId)?.premium === true,
  };
}

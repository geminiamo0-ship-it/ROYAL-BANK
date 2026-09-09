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
  name: string;
  code: string;
  edition: string;
  questionCount: number;
  mockExamCount: number;
  textbookArticleCount: number;
  description: string;
  features: string[];
  isFreeTrialAvailable: boolean;
  isUnlocked: boolean;
  hasPremiumAccess: boolean;
  thumbnailUrl?: string;
  badge?: string;
}

export interface PathwayDetail {
  id: number;
  slug: string;
  name: string;
  code: string;
  category: string;
  description: string;
  totalQuestions: number;
  isUnlocked: boolean;
  hasFullAccess: boolean;
  activeAccess: ActiveAccessGrant[];
  banks: QuestionBankItem[];
}

type StaticQuestionBank = Omit<QuestionBankItem, 'isUnlocked' | 'hasPremiumAccess'>;
type StaticPathway = Omit<PathwayDetail, 'isUnlocked' | 'hasFullAccess' | 'activeAccess' | 'banks'> & {
  banks: StaticQuestionBank[];
};

const PATHWAYS_DATA: Record<string, StaticPathway> = {
  'mrcp-part-1': {
    id: 1,
    slug: 'mrcp-part-1',
    name: 'MRCP Part 1',
    code: 'MRCP-1',
    category: 'Internal Medicine',
    description: 'Royal College of Physicians Examination Part 1. Choose from our specialized banks with full clinical explanations and isolated analytics.',
    totalQuestions: 13444,
    banks: [
      {
        id: 1,
        pathwayId: 1,
        name: 'MRCP Part 1 — PassMedicine Edition',
        code: 'PASSMED',
        edition: 'PassMedicine Core Bank',
        questionCount: 5444,
        mockExamCount: 3,
        textbookArticleCount: 650,
        description: 'Over 5,444 Single Best Answer questions + 3 full mock exams + high-yield MRCP textbook with peer percentage bars.',
        features: [
          '5,444 Verified Clinical Questions',
          '650 High-Yield Textbook Chapters',
          'Peer Answer Percentages (Live Benchmark)',
          'AI-Optimized Question Sequencing',
          'Saved Concepts (Important / Less Important)'
        ],
        isFreeTrialAvailable: true,
        badge: 'Recommended'
      },
      {
        id: 2,
        pathwayId: 1,
        name: 'MRCP Part 1 — Pastest Edition',
        code: 'PASTEST',
        edition: 'Pastest Practice Bank',
        questionCount: 4200,
        mockExamCount: 4,
        textbookArticleCount: 450,
        description: 'Over 4,200 past-paper aligned questions focusing on diagnostic data interpretation, ECGs, and imaging vignettes.',
        features: [
          '4,200 High-Yield Exam Vignettes',
          'Comprehensive Past-Paper Explanations',
          'Extended Clinical Sciences Library',
          'Topic-Specific Revision Sets'
        ],
        isFreeTrialAvailable: false,
        badge: 'Popular'
      },
      {
        id: 3,
        pathwayId: 1,
        name: 'MRCP Part 1 — 1Exam / OnExamination Edition',
        code: 'ONEXAM',
        edition: 'BMJ OnExamination Bank',
        questionCount: 3800,
        mockExamCount: 2,
        textbookArticleCount: 320,
        description: 'Over 3,800 questions emphasizing clinical pharmacology, statistics, and subspecialty internal medicine scenarios.',
        features: [
          '3,800 Curated Assessment Questions',
          'Detailed Clinical Guidelines & NICE Pathways',
          'Timed Benchmark Simulation Mode'
        ],
        isFreeTrialAvailable: false,
        badge: 'Advanced'
      },
    ],
  },
  'mrcog-part-1': {
    id: 2,
    slug: 'mrcog-part-1',
    name: 'MRCOG Part 1',
    code: 'MRCOG-1',
    category: 'Obstetrics & Gynaecology',
    description: 'Royal College of Obstetricians and Gynaecologists Part 1 Examination.',
    totalQuestions: 3200,
    banks: [
      {
        id: 4,
        pathwayId: 2,
        name: 'MRCOG Part 1 — Comprehensive Bank',
        code: 'MRCOG-MAIN',
        edition: 'O&G Core Bank',
        questionCount: 3200,
        mockExamCount: 2,
        textbookArticleCount: 280,
        description: 'Over 3,200 questions covering core basic sciences in embryology, anatomy, reproductive physiology, and pharmacology.',
        features: [
          '3,200 Syllabus-Matched Questions',
          'Core Basic Sciences Revision Modules',
          'Full Exam Simulation'
        ],
        isFreeTrialAvailable: false,
      }
    ],
  },
  'mrcs-part-a': {
    id: 3,
    slug: 'mrcs-part-a',
    name: 'MRCS Part A',
    code: 'MRCS-A',
    category: 'Surgery',
    description: 'Intercollegiate MRCS Part A Examination preparation.',
    totalQuestions: 4100,
    banks: [
      {
        id: 5,
        pathwayId: 3,
        name: 'MRCS Part A — Surgical Principles Bank',
        code: 'MRCS-MAIN',
        edition: 'Surgery Core Bank',
        questionCount: 4100,
        mockExamCount: 3,
        textbookArticleCount: 350,
        description: 'Surgical anatomy, physiology, critical care, and principles of surgery in general.',
        features: [
          '4,100 Applied Surgical Questions',
          'Cadaveric Anatomy & Imaging Tracings',
          'Paper 1 & Paper 2 Format'
        ],
        isFreeTrialAvailable: false,
      }
    ],
  },
  'plab-ukmla': {
    id: 4,
    slug: 'plab-ukmla',
    name: 'PLAB 1 / UKMLA',
    code: 'PLAB-1',
    category: 'General Clinical Practice',
    description: 'GMC General Medical Council Licensing Examination (UKMLA).',
    totalQuestions: 4800,
    banks: [
      {
        id: 6,
        pathwayId: 4,
        name: 'PLAB 1 / UKMLA — Clinical Practice Bank',
        code: 'PLAB-MAIN',
        edition: 'UKMLA Core Bank',
        questionCount: 4800,
        mockExamCount: 4,
        textbookArticleCount: 400,
        description: 'High-yield clinical vignettes, emergency protocols, and UK healthcare ethical scenarios.',
        features: [
          '4,800 UKMLA Focused Questions',
          'GMC Good Medical Practice Protocols',
          'Full Gold-Standard Mock Exams'
        ],
        isFreeTrialAvailable: false,
      }
    ],
  },
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
    bankIds.map((id) => [id, { unlocked: false, premium: false }])
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

      access.set(bankId, {
        unlocked: !contentResult.error && contentResult.data === true,
        premium: !premiumResult.error && premiumResult.data === true,
      });
    })
  );

  const grantsResult = await grantsPromise;
  return {
    access,
    grants: grantsResult.error ? [] : ((grantsResult.data || []) as ActiveAccessGrant[]),
  };
}

export async function getPathwayDetails(slug: string): Promise<PathwayDetail | null> {
  const pathway = PATHWAYS_DATA[slug];
  if (!pathway) return null;

  const banks = pathway.banks.map((bank) => ({ ...bank, features: [...bank.features] }));

  try {
    const resolved = await resolveBankAccess(banks.map((bank) => bank.id));
    const resolvedBanks: QuestionBankItem[] = banks.map((bank) => ({
      ...bank,
      isUnlocked: resolved.access.get(bank.id)?.unlocked === true,
      hasPremiumAccess: resolved.access.get(bank.id)?.premium === true,
    }));
    const bankIds = new Set(resolvedBanks.map((bank) => bank.id));
    const activeAccess = resolved.grants.filter((grant) =>
      grant.scope_type === 'global'
      || (grant.scope_type === 'pathway' && grant.pathway_id === pathway.id)
      || (grant.scope_type === 'bank' && grant.question_bank_id !== null && bankIds.has(grant.question_bank_id))
    );
    const directFullGrant = activeAccess.some(
      (grant) => grant.scope_type === 'global' || (grant.scope_type === 'pathway' && grant.pathway_id === pathway.id)
    );

    return {
      ...pathway,
      isUnlocked: resolvedBanks.some((bank) => bank.isUnlocked),
      hasFullAccess: directFullGrant || (resolvedBanks.length > 0 && resolvedBanks.every((bank) => bank.hasPremiumAccess)),
      activeAccess,
      banks: resolvedBanks,
    };
  } catch {
    return {
      ...pathway,
      isUnlocked: false,
      hasFullAccess: false,
      activeAccess: [],
      banks: banks.map((bank) => ({ ...bank, isUnlocked: false, hasPremiumAccess: false })),
    };
  }
}

export async function getBankDetails(bankId: number): Promise<QuestionBankItem | null> {
  const bank = Object.values(PATHWAYS_DATA)
    .flatMap((pathway) => pathway.banks)
    .find((candidate) => candidate.id === bankId);

  if (!bank) return null;

  try {
    const resolved = await resolveBankAccess([bankId]);
    return {
      ...bank,
      features: [...bank.features],
      isUnlocked: resolved.access.get(bankId)?.unlocked === true,
      hasPremiumAccess: resolved.access.get(bankId)?.premium === true,
    };
  } catch {
    return {
      ...bank,
      features: [...bank.features],
      isUnlocked: false,
      hasPremiumAccess: false,
    };
  }
}

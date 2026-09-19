import 'server-only';

import { isPrivateR2Configured, readPrivateR2Json } from '@/lib/r2-private';

const EDGE_ROOT = (process.env.ROYAL_EDGE_R2_CONTENT_ROOT?.trim() || 'exam-content-v2')
  .replace(/^\/+|\/+$/g, '');
const UI_ROOT = (process.env.ROYAL_UI_STATIC_R2_ROOT?.trim() || 'ui-static-v1')
  .replace(/^\/+|\/+$/g, '');
const RELEASE_ID_PATTERN = /^[0-9a-f]{64}$/;

type ActiveEdgeRelease = {
  schema_version?: number;
  release_id?: string;
  prefix?: string;
};

export type StaticCatalogRows = {
  schema_version: 1;
  generated_at: string;
  pathways: Array<{
    id: number;
    slug: string;
    name: string;
    description: string | null;
    icon_url: string | null;
    is_free_trial_available: boolean | null;
    display_order: number | null;
  }>;
  banks: Array<{
    id: number;
    pathway_id: number;
    name: string;
    description: string | null;
    display_order: number | null;
    is_free_trial: boolean | null;
    free_trial_block_limit: number | null;
    free_trial_question_limit: number | null;
    free_trial_article_limit: number | null;
  }>;
};

export type StaticBankSelectionIndex = {
  schema_version: 1;
  release_id: string;
  bank_id: number;
  questions: Array<{
    id: number;
    difficulty: string;
    category: string;
    topic: string | null;
  }>;
};

export type StaticLibraryArticle = {
  schema_version: 1;
  id: string;
  name: string;
  category: string | null;
  topic: string | null;
  content_html: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function resolveActiveEdgeRelease(): Promise<{ releaseId: string; prefix: string } | null> {
  if (!isPrivateR2Configured()) return null;
  try {
    const raw = await readPrivateR2Json<ActiveEdgeRelease>(`${EDGE_ROOT}/active.json`, {
      maxBytes: 32 * 1024,
    });
    const releaseId = typeof raw?.release_id === 'string' ? raw.release_id : '';
    const prefix = typeof raw?.prefix === 'string' ? raw.prefix.replace(/^\/+|\/+$/g, '') : '';
    if (!RELEASE_ID_PATTERN.test(releaseId)) return null;
    if (prefix !== `${EDGE_ROOT}/releases/${releaseId}`) return null;
    return { releaseId, prefix };
  } catch {
    return null;
  }
}

export async function readStaticCatalogRows(): Promise<StaticCatalogRows | null> {
  if (!isPrivateR2Configured()) return null;
  try {
    const raw = await readPrivateR2Json<unknown>(`${UI_ROOT}/catalog/current.json`, {
      maxBytes: 512 * 1024,
    });
    const record = asRecord(raw);
    if (
      Number(record?.schema_version) !== 1 ||
      !Array.isArray(record?.pathways) ||
      !Array.isArray(record?.banks)
    ) {
      return null;
    }
    return record as unknown as StaticCatalogRows;
  } catch {
    return null;
  }
}

export async function readStaticBankSelectionIndex(bankId: number): Promise<StaticBankSelectionIndex | null> {
  if (!Number.isSafeInteger(bankId) || bankId <= 0) return null;
  const release = await resolveActiveEdgeRelease();
  if (!release) return null;

  try {
    const raw = await readPrivateR2Json<StaticBankSelectionIndex>(
      `${release.prefix}/selection/banks/${bankId}.json`,
      { maxBytes: 4 * 1024 * 1024 },
    );
    if (
      raw?.schema_version !== 1 ||
      raw.release_id !== release.releaseId ||
      Number(raw.bank_id) !== bankId ||
      !Array.isArray(raw.questions)
    ) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

export async function readStaticLibraryArticle(articleId: string): Promise<StaticLibraryArticle | null> {
  if (!isPrivateR2Configured() || !articleId || articleId.length > 512) return null;
  const key = `${UI_ROOT}/library/articles/${encodeURIComponent(articleId)}.json`;

  try {
    const raw = await readPrivateR2Json<unknown>(key, { maxBytes: 4 * 1024 * 1024 });
    const record = asRecord(raw);
    if (
      Number(record?.schema_version) !== 1 ||
      record?.id !== articleId ||
      typeof record?.name !== 'string' ||
      typeof record?.content_html !== 'string'
    ) {
      return null;
    }
    return record as unknown as StaticLibraryArticle;
  } catch {
    return null;
  }
}

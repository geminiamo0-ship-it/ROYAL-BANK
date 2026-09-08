import 'server-only';

import { createClient } from '@/lib/supabase/server';

export interface LibraryArticleSummary {
  id: string;
  name: string;
  category: string | null;
  isDisclosed: boolean;
}

export interface LibraryCatalog {
  bankId: number;
  articles: LibraryArticleSummary[];
  premiumAccess: boolean;
  trialLimit: number | null;
  trialRemaining: number | null;
}

export interface LibraryArticleContent {
  id: string;
  name: string;
  category: string | null;
  contentHtml: string;
}

export interface LibraryArticleAccessState {
  premium: boolean;
  trial: boolean;
  firstDisclosure: boolean;
  trialLimit: number | null;
  trialUsed: number | null;
  trialRemaining: number | null;
}

export interface LibraryArticleRead {
  article: LibraryArticleContent;
  access: LibraryArticleAccessState;
}

export class LibraryAuthenticationError extends Error {
  constructor() {
    super('Authentication required');
    this.name = 'LibraryAuthenticationError';
  }
}

export class LibraryAccessError extends Error {
  constructor() {
    super('Library access denied');
    this.name = 'LibraryAccessError';
  }
}

export class LibraryTrialLimitError extends Error {
  constructor() {
    super('Library trial limit reached');
    this.name = 'LibraryTrialLimitError';
  }
}

export class LibraryNotFoundError extends Error {
  constructor() {
    super('Library content not found');
    this.name = 'LibraryNotFoundError';
  }
}

interface LibraryListRpcRow {
  article_id: string;
  article_name: string;
  category: string | null;
  is_disclosed: boolean;
  premium_access: boolean;
  trial_limit: number | null;
  trial_remaining: number | null;
}

interface LibraryArticleRpcPayload {
  article?: {
    id?: unknown;
    name?: unknown;
    category?: unknown;
    content_html?: unknown;
  };
  access?: {
    premium?: unknown;
    trial?: unknown;
    first_disclosure?: unknown;
    trial_limit?: unknown;
    trial_used?: unknown;
    trial_remaining?: unknown;
  };
}

function ensureBankId(bankId: number): void {
  if (!Number.isInteger(bankId) || bankId <= 0) {
    throw new LibraryNotFoundError();
  }
}

function classifyRpcError(message: string | undefined): Error {
  const normalized = message ?? '';

  if (/ACTIVE_AUTHENTICATION_REQUIRED|Not authenticated|authentication required/i.test(normalized)) {
    return new LibraryAuthenticationError();
  }

  if (/LIBRARY_TRIAL_LIMIT/i.test(normalized)) {
    return new LibraryTrialLimitError();
  }

  if (/LIBRARY_ARTICLE_NOT_FOUND|QUESTION_BANK_NOT_FOUND/i.test(normalized)) {
    return new LibraryNotFoundError();
  }

  if (/LIBRARY_ACCESS_DENIED|access denied|Premium access required/i.test(normalized)) {
    return new LibraryAccessError();
  }

  // Fail closed and never surface provider/database diagnostics to the browser.
  return new LibraryAccessError();
}

async function requireAuthenticatedClient() {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    throw new LibraryAuthenticationError();
  }

  return client;
}

export async function getLibraryCatalog(bankId: number): Promise<LibraryCatalog> {
  ensureBankId(bankId);
  const client = await requireAuthenticatedClient();

  const { data, error } = await client.rpc('list_library_articles', {
    p_bank_id: bankId,
  });

  if (error) {
    throw classifyRpcError(error.message);
  }

  const rows = (Array.isArray(data) ? data : []) as LibraryListRpcRow[];
  const first = rows[0];

  return {
    bankId,
    articles: rows.map((row) => ({
      id: row.article_id,
      name: row.article_name,
      category: row.category,
      isDisclosed: row.is_disclosed === true,
    })),
    premiumAccess: first?.premium_access === true,
    trialLimit: typeof first?.trial_limit === 'number' ? first.trial_limit : null,
    trialRemaining:
      typeof first?.trial_remaining === 'number' ? first.trial_remaining : null,
  };
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function readLibraryArticle(
  bankId: number,
  articleId: string
): Promise<LibraryArticleRead> {
  ensureBankId(bankId);
  if (!articleId || articleId.length > 512) {
    throw new LibraryNotFoundError();
  }

  const client = await requireAuthenticatedClient();
  const { data, error } = await client.rpc('get_library_article', {
    p_bank_id: bankId,
    p_article_id: articleId,
  });

  if (error) {
    throw classifyRpcError(error.message);
  }

  const payload = (data ?? {}) as LibraryArticleRpcPayload;
  const article = payload.article;
  const access = payload.access;

  if (
    !article ||
    typeof article.id !== 'string' ||
    typeof article.name !== 'string' ||
    typeof article.content_html !== 'string' ||
    !access
  ) {
    throw new LibraryNotFoundError();
  }

  return {
    article: {
      id: article.id,
      name: article.name,
      category: typeof article.category === 'string' ? article.category : null,
      contentHtml: article.content_html,
    },
    access: {
      premium: access.premium === true,
      trial: access.trial === true,
      firstDisclosure: access.first_disclosure === true,
      trialLimit: nullableNumber(access.trial_limit),
      trialUsed: nullableNumber(access.trial_used),
      trialRemaining: nullableNumber(access.trial_remaining),
    },
  };
}

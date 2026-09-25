import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { rewriteExamMediaHtml } from '@/lib/exam-html';
import { isPrivateR2Configured } from '@/lib/r2-private';
import { readStaticLibraryArticle, readStaticLibraryCatalog } from '@/lib/ui-static-r2';

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

interface LibraryCatalogAccessPayload {
  premium_access?: unknown;
  trial_limit?: unknown;
  trial_remaining?: unknown;
  disclosed_article_ids?: unknown;
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

interface LibraryAuthorizationRpcPayload {
  article_id?: unknown;
  access?: LibraryArticleRpcPayload['access'];
}

interface LibraryContentRpcPayload {
  id?: unknown;
  name?: unknown;
  category?: unknown;
  content_html?: unknown;
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

async function createLibraryClient() {
  // Library RPCs are the authorization boundary; avoid an extra auth.getUser()
  // request before every catalog/article call.
  return createClient();
}

async function getLegacyLibraryCatalog(
  client: Awaited<ReturnType<typeof createLibraryClient>>,
  bankId: number,
): Promise<LibraryCatalog> {
  const { data, error } = await client.rpc('list_library_articles', { p_bank_id: bankId });
  if (error) throw classifyRpcError(error.message);

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
    trialRemaining: typeof first?.trial_remaining === 'number' ? first.trial_remaining : null,
  };
}

export async function getLibraryCatalog(bankId: number): Promise<LibraryCatalog> {
  ensureBankId(bankId);
  const client = await createLibraryClient();

  const [staticCatalog, accessResult] = await Promise.all([
    readStaticLibraryCatalog(bankId),
    client.rpc('get_library_catalog_access_state', { p_bank_id: bankId }),
  ]);

  if (accessResult.error) {
    if (rpcMissing(accessResult.error.message, 'get_library_catalog_access_state')) {
      return getLegacyLibraryCatalog(client, bankId);
    }
    throw classifyRpcError(accessResult.error.message);
  }

  if (!staticCatalog) {
    return getLegacyLibraryCatalog(client, bankId);
  }

  const access = (accessResult.data ?? {}) as LibraryCatalogAccessPayload;
  const disclosedIds = new Set(
    Array.isArray(access.disclosed_article_ids)
      ? access.disclosed_article_ids.filter((value): value is string => typeof value === 'string')
      : [],
  );

  return {
    bankId,
    articles: staticCatalog.articles.map((article) => ({
      id: article.id,
      name: article.name,
      category: article.category,
      isDisclosed: disclosedIds.has(article.id),
    })),
    premiumAccess: access.premium_access === true,
    trialLimit: nullableNumber(access.trial_limit),
    trialRemaining: nullableNumber(access.trial_remaining),
  };
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseAccess(access: LibraryArticleRpcPayload['access']): LibraryArticleAccessState {
  if (!access) throw new LibraryNotFoundError();
  return {
    premium: access.premium === true,
    trial: access.trial === true,
    firstDisclosure: access.first_disclosure === true,
    trialLimit: nullableNumber(access.trial_limit),
    trialUsed: nullableNumber(access.trial_used),
    trialRemaining: nullableNumber(access.trial_remaining),
  };
}

function parseArticle(article: LibraryContentRpcPayload | undefined): LibraryArticleContent {
  if (
    !article ||
    typeof article.id !== 'string' ||
    typeof article.name !== 'string' ||
    typeof article.content_html !== 'string'
  ) {
    throw new LibraryNotFoundError();
  }
  return {
    id: article.id,
    name: article.name,
    category: typeof article.category === 'string' ? article.category : null,
    contentHtml: rewriteExamMediaHtml(article.content_html),
  };
}

async function readLegacyLibraryArticle(
  client: Awaited<ReturnType<typeof createLibraryClient>>,
  bankId: number,
  articleId: string,
): Promise<LibraryArticleRead> {
  const { data, error } = await client.rpc('get_library_article', {
    p_bank_id: bankId,
    p_article_id: articleId,
  });
  if (error) throw classifyRpcError(error.message);

  const payload = (data ?? {}) as LibraryArticleRpcPayload;
  return {
    article: parseArticle(payload.article),
    access: parseAccess(payload.access),
  };
}

function rpcMissing(message: string | undefined, functionName: string): boolean {
  const value = message || '';
  return /function .* does not exist|could not find the function/i.test(value)
    && value.toLowerCase().includes(functionName.toLowerCase());
}

export async function readLibraryArticle(
  bankId: number,
  articleId: string
): Promise<LibraryArticleRead> {
  ensureBankId(bankId);
  if (!articleId || articleId.length > 512) {
    throw new LibraryNotFoundError();
  }

  const client = await createLibraryClient();

  // Until private R2 is configured, preserve the original one-RPC path rather
  // than adding an authorization round trip with no cache benefit.
  if (!isPrivateR2Configured()) {
    return readLegacyLibraryArticle(client, bankId, articleId);
  }

  const authorization = await client.rpc('authorize_library_article_read', {
    p_bank_id: bankId,
    p_article_id: articleId,
  });

  if (authorization.error) {
    if (rpcMissing(authorization.error.message, 'authorize_library_article_read')) {
      return readLegacyLibraryArticle(client, bankId, articleId);
    }
    throw classifyRpcError(authorization.error.message);
  }

  const authorizationPayload = (authorization.data ?? {}) as LibraryAuthorizationRpcPayload;
  const access = parseAccess(authorizationPayload.access);

  const cached = await readStaticLibraryArticle(articleId);
  if (cached) {
    return {
      article: {
        id: cached.id,
        name: cached.name,
        category: cached.category,
        contentHtml: rewriteExamMediaHtml(cached.content_html),
      },
      access,
    };
  }

  // R2 rollout/fetch failure is non-fatal. This fallback is disclosure-safe:
  // the content-only RPC allows premium users or an already-disclosed trial
  // article, so it cannot bypass the trial quota on its own.
  const content = await client.rpc('get_library_article_content_authorized', {
    p_bank_id: bankId,
    p_article_id: articleId,
  });

  if (content.error) {
    if (rpcMissing(content.error.message, 'get_library_article_content_authorized')) {
      const legacy = await readLegacyLibraryArticle(client, bankId, articleId);
      return { article: legacy.article, access };
    }
    throw classifyRpcError(content.error.message);
  }

  return {
    article: parseArticle((content.data ?? {}) as LibraryContentRpcPayload),
    access,
  };
}

'use server';

import {
  LibraryAccessError,
  LibraryAuthenticationError,
  LibraryNotFoundError,
  LibraryTrialLimitError,
  readLibraryArticle,
  type LibraryArticleRead,
} from '@/lib/library';

export type LibraryArticleActionResult =
  | { ok: true; data: LibraryArticleRead }
  | {
      ok: false;
      code: 'AUTH_REQUIRED' | 'ACCESS_DENIED' | 'TRIAL_LIMIT' | 'NOT_FOUND';
    };

export async function openLibraryArticleAction(
  bankId: number,
  articleId: string
): Promise<LibraryArticleActionResult> {
  try {
    const data = await readLibraryArticle(bankId, articleId);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof LibraryAuthenticationError) {
      return { ok: false, code: 'AUTH_REQUIRED' };
    }
    if (error instanceof LibraryTrialLimitError) {
      return { ok: false, code: 'TRIAL_LIMIT' };
    }
    if (error instanceof LibraryNotFoundError) {
      return { ok: false, code: 'NOT_FOUND' };
    }
    if (error instanceof LibraryAccessError) {
      return { ok: false, code: 'ACCESS_DENIED' };
    }

    return { ok: false, code: 'ACCESS_DENIED' };
  }
}

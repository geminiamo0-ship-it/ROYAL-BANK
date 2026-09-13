import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, BookOpen } from 'lucide-react';
import {
  LibraryAccessError,
  LibraryAuthenticationError,
  LibraryNotFoundError,
  LibraryTrialLimitError,
  readLibraryArticle,
  type LibraryArticleRead,
} from '@/lib/library';

export default async function HighYieldArticlePage({
  params,
}: {
  params: Promise<{ bankId: string; articleId: string }>;
}) {
  const { bankId, articleId } = await params;
  const parsedBankId = Number(bankId);
  if (!Number.isInteger(parsedBankId) || parsedBankId <= 0 || !articleId) notFound();

  let result: LibraryArticleRead;
  try {
    result = await readLibraryArticle(parsedBankId, articleId);
  } catch (error) {
    if (error instanceof LibraryAuthenticationError) {
      redirect(`/login?redirect=/bank/${parsedBankId}/textbook/high-yield/${encodeURIComponent(articleId)}`);
    }
    if (error instanceof LibraryTrialLimitError) {
      redirect(`/bank/${parsedBankId}/textbook/high-yield?trial=complete`);
    }
    if (error instanceof LibraryAccessError) {
      redirect('/dashboard?upgrade=true');
    }
    if (error instanceof LibraryNotFoundError) notFound();
    throw error;
  }

  return (
    <div className="mx-auto max-w-[900px] space-y-4 pb-16">
      <Link
        href={`/bank/${parsedBankId}/study-plan`}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Study Plan
      </Link>
      <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950 sm:p-9">
        <div className="border-b border-slate-100 pb-5 dark:border-slate-800">
          <div className="flex items-center gap-2 text-[#a17c35]">
            <BookOpen className="h-4 w-4" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">Study Topic</span>
          </div>
          <p className="mt-3 text-xs font-semibold text-slate-400">{result.article.category || 'General'}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-[#172238] dark:text-white">{result.article.name}</h1>
        </div>
        <div
          className="pm-explanation-container pt-6 leading-relaxed text-slate-800 dark:text-slate-200"
          dangerouslySetInnerHTML={{ __html: result.article.contentHtml }}
        />
      </article>
    </div>
  );
}

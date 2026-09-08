'use client';

import React, { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, Check, ChevronRight, Lock, Search } from 'lucide-react';
import { openLibraryArticleAction } from '@/actions/library';
import type {
  LibraryArticleContent,
  LibraryArticleSummary,
  LibraryCatalog,
} from '@/lib/library';

interface HighYieldTextbookClientProps {
  bankId: number;
  initialCatalog: LibraryCatalog;
}

export function HighYieldTextbookClient({
  bankId,
  initialCatalog,
}: HighYieldTextbookClientProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [activeArticle, setActiveArticle] = useState<LibraryArticleContent | null>(null);
  const [loadingArticleId, setLoadingArticleId] = useState<string | null>(null);
  const [trialRemaining, setTrialRemaining] = useState<number | null>(
    initialCatalog.trialRemaining
  );
  const [disclosedIds, setDisclosedIds] = useState(
    () => new Set(initialCatalog.articles.filter((article) => article.isDisclosed).map((article) => article.id))
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const categories = useMemo(
    () => [
      'All',
      ...Array.from(
        new Set(
          initialCatalog.articles
            .map((article) => article.category)
            .filter((category): category is string => Boolean(category))
        )
      ).sort((a, b) => a.localeCompare(b)),
    ],
    [initialCatalog.articles]
  );

  const filteredArticles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return initialCatalog.articles.filter((article) => {
      const matchesCategory =
        selectedCategory === 'All' || article.category === selectedCategory;
      const matchesSearch =
        query.length === 0 ||
        article.name.toLowerCase().includes(query) ||
        (article.category ?? '').toLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [initialCatalog.articles, searchQuery, selectedCategory]);

  const openArticle = (article: LibraryArticleSummary) => {
    const alreadyDisclosed = disclosedIds.has(article.id);
    const canOpenNewArticle =
      initialCatalog.premiumAccess || alreadyDisclosed || (trialRemaining ?? 0) > 0;

    if (!canOpenNewArticle) {
      setErrorMessage('Your free library preview is complete. Upgrade to open another article.');
      return;
    }

    setErrorMessage(null);
    setLoadingArticleId(article.id);

    startTransition(async () => {
      const result = await openLibraryArticleAction(bankId, article.id);
      setLoadingArticleId(null);

      if (!result.ok) {
        if (result.code === 'AUTH_REQUIRED') {
          router.push(`/login?redirect=/bank/${bankId}/textbook/high-yield`);
          return;
        }
        if (result.code === 'TRIAL_LIMIT') {
          setTrialRemaining(0);
          setErrorMessage('Your free library preview is complete. Upgrade to open another article.');
          return;
        }
        if (result.code === 'NOT_FOUND') {
          setErrorMessage('This article is no longer available.');
          return;
        }

        setErrorMessage('This library is not included in your current access.');
        return;
      }

      setActiveArticle(result.data.article);
      setTrialRemaining(result.data.access.trialRemaining);
      if (result.data.access.firstDisclosure) {
        setDisclosedIds((current) => {
          const next = new Set(current);
          next.add(article.id);
          return next;
        });
      }
    });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16 text-xs sm:text-sm">
      <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-pink-100 dark:bg-pink-950/60 text-pink-700 dark:text-pink-300 flex items-center justify-center font-bold">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">
              High-Yield Clinical Textbook
            </h1>
            <p className="text-xs text-slate-500">
              {initialCatalog.articles.length.toLocaleString()} revision articles mapped to this bank
            </p>
          </div>
        </div>

        <div className="flex w-full sm:w-auto flex-col sm:items-end gap-2">
          <AccessBadge
            premium={initialCatalog.premiumAccess}
            trialLimit={initialCatalog.trialLimit}
            trialRemaining={trialRemaining}
          />
          <div className="w-full sm:w-72 relative">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search textbook topics..."
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {errorMessage}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex gap-1.5 overflow-x-auto">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition-all ${
                  selectedCategory === category
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                {category}
              </button>
            ))}
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[620px] overflow-y-auto">
            {filteredArticles.map((article) => {
              const isSelected = activeArticle?.id === article.id;
              const isDisclosed = disclosedIds.has(article.id);
              const locked =
                !initialCatalog.premiumAccess && !isDisclosed && (trialRemaining ?? 0) <= 0;
              const isLoading = isPending && loadingArticleId === article.id;

              return (
                <button
                  key={article.id}
                  onClick={() => openArticle(article)}
                  disabled={isLoading}
                  className={`w-full p-3.5 text-left flex items-center justify-between gap-3 transition-colors ${
                    isSelected
                      ? 'bg-blue-50/70 dark:bg-blue-950/40 border-l-4 border-blue-600'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  } ${isLoading ? 'opacity-60' : ''}`}
                >
                  <div className="min-w-0">
                    <p className={`font-semibold text-xs truncate ${isSelected ? 'text-blue-900 dark:text-blue-200' : 'text-slate-900 dark:text-white'}`}>
                      {article.name}
                    </p>
                    <span className="text-[11px] text-slate-400 font-medium">
                      {article.category || 'General'}
                    </span>
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5">
                    {!initialCatalog.premiumAccess && isDisclosed && (
                      <Check className="h-3.5 w-3.5 text-emerald-500" aria-label="Previously opened" />
                    )}
                    {locked ? (
                      <Lock className="h-3.5 w-3.5 text-slate-400" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                    )}
                  </div>
                </button>
              );
            })}

            {filteredArticles.length === 0 && (
              <div className="p-6 text-center text-slate-400">No articles match your filters.</div>
            )}
          </div>
        </div>

        <div className="lg:col-span-8 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-xs min-h-[520px]">
          {activeArticle ? (
            <div>
              <div className="pb-4 border-b border-slate-200 dark:border-slate-800">
                <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-300">
                  {activeArticle.category || 'General'}
                </span>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white mt-1.5">
                  {activeArticle.name}
                </h2>
              </div>
              <div
                className="pm-explanation-container pt-6 text-slate-800 dark:text-slate-200 leading-relaxed"
                dangerouslySetInnerHTML={{ __html: activeArticle.contentHtml }}
              />
            </div>
          ) : (
            <div className="min-h-[450px] flex flex-col items-center justify-center text-center text-slate-400 px-8">
              <BookOpen className="h-9 w-9 mb-3" />
              <p className="font-semibold text-slate-600 dark:text-slate-300">Select an article to read</p>
              {!initialCatalog.premiumAccess && (
                <p className="mt-1 max-w-md">
                  An article counts toward the free preview only when you open it. Reopening the same article does not use another slot.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AccessBadge({
  premium,
  trialLimit,
  trialRemaining,
}: {
  premium: boolean;
  trialLimit: number | null;
  trialRemaining: number | null;
}) {
  if (premium) {
    return (
      <span className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
        Full library access
      </span>
    );
  }

  const total = trialLimit ?? 0;
  const remaining = trialRemaining ?? 0;
  return (
    <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
      Free preview: {remaining} of {total} new articles remaining
    </span>
  );
}

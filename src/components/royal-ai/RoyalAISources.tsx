'use client';

import { useEffect, useState } from 'react';
import { BookOpen, Loader2, Lock, X } from 'lucide-react';
import { openLibraryArticleAction } from '@/actions/library';

type OpenedLibraryArticle = { id: string; name: string; category: string | null; contentHtml: string };

export type RoyalAISourceCard = {
  id: string;
  title: string;
  articleId: string | null;
  bankId: number | null;
  score?: number;
};

export function RoyalAISources({ sources }: { sources: RoyalAISourceCard[] }) {
  const [active, setActive] = useState<RoyalAISourceCard | null>(null);

  if (!sources.length) return null;

  return (
    <>
      <details className="mt-2">
        <summary className="cursor-pointer text-[10px] font-semibold text-[#9a722d] dark:text-[#e0bf73]">
          Sources used · {sources.length}
        </summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {sources.map((source) => (
            <div
              key={source.id + source.title}
              className="rounded-xl border border-black/8 bg-black/[.015] px-3 py-2 dark:border-white/8 dark:bg-white/[.025]"
            >
              <p className="text-[9px] font-bold text-[#9a722d]">{source.id}</p>
              <p className="mt-0.5 text-[10.5px] font-semibold">{source.title}</p>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <p className="text-[9px] text-[#8a8175] dark:text-white/35">Source used by Royal</p>
                {source.articleId && source.bankId ? (
                  <button
                    type="button"
                    onClick={() => setActive(source)}
                    className="inline-flex items-center gap-1 rounded-full border border-[#c9a75f]/25 px-2 py-1 text-[8.5px] font-bold text-[#9a722d] transition hover:border-[#c9a75f]/55 dark:text-[#e0bf73]"
                  >
                    <BookOpen className="h-3 w-3" />
                    Open source
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </details>

      {active ? <RoyalAISourceViewer source={active} onClose={() => setActive(null)} /> : null}
    </>
  );
}

function RoyalAISourceViewer({
  source,
  onClose,
}: {
  source: RoyalAISourceCard;
  onClose: () => void;
}) {
  const [article, setArticle] = useState<OpenedLibraryArticle | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'locked' | 'missing' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!source.articleId || !source.bankId) {
        if (!cancelled) setState('missing');
        return;
      }

      const result = await openLibraryArticleAction(source.bankId, source.articleId);
      if (cancelled) return;

      if (!result.ok) {
        setState(
          result.code === 'ACCESS_DENIED' || result.code === 'TRIAL_LIMIT'
            ? 'locked'
            : result.code === 'NOT_FOUND'
              ? 'missing'
              : 'error',
        );
        return;
      }

      setArticle(result.data.article);
      setState('ready');
    }

    void load().catch(() => {
      if (!cancelled) setState('error');
    });

    return () => {
      cancelled = true;
    };
  }, [source.articleId, source.bankId]);

  return (
    <div className="absolute inset-0 z-40 flex items-end bg-black/35 backdrop-blur-[2px] sm:items-stretch sm:justify-end">
      <section className="flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-[#fffdf8] shadow-2xl dark:bg-[#121a20] sm:max-h-none sm:w-[min(720px,92vw)] sm:rounded-none sm:border-l sm:border-black/10 dark:sm:border-white/10">
        <header className="flex h-[62px] shrink-0 items-center justify-between border-b border-black/8 px-4 dark:border-white/8">
          <div className="min-w-0">
            <p className="text-[8px] font-bold uppercase tracking-[.14em] text-[#9a722d]">Royal source</p>
            <h3 className="truncate font-serif text-[15px] font-semibold">{source.title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close source"
            className="grid h-9 w-9 place-items-center rounded-full hover:bg-black/5 dark:hover:bg-white/7"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">
          {state === 'loading' ? (
            <div className="flex min-h-[280px] items-center justify-center gap-2 text-[11px] text-[#827a70] dark:text-white/45">
              <Loader2 className="h-4 w-4 animate-spin text-[#b88a32]" />
              Checking your library access…
            </div>
          ) : null}

          {state === 'locked' ? (
            <div className="mx-auto flex min-h-[320px] max-w-md flex-col items-center justify-center text-center">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-[#c9a75f]/10 text-[#a97a27]">
                <Lock className="h-5 w-5" />
              </div>
              <h4 className="mt-4 font-serif text-lg font-semibold">Source available in Royal Library</h4>
              <p className="mt-2 text-[11px] leading-5 text-[#766e63] dark:text-white/45">
                Royal can use this source to ground the answer, but the full article is not included in your current library access.
              </p>
            </div>
          ) : null}

          {state === 'missing' || state === 'error' ? (
            <div className="mx-auto flex min-h-[280px] max-w-md items-center justify-center text-center text-[11px] leading-5 text-[#766e63] dark:text-white/45">
              {state === 'missing'
                ? 'This source is no longer available to open.'
                : 'Royal could not open this source right now. Your chat is unaffected.'}
            </div>
          ) : null}

          {state === 'ready' && article ? (
            <article>
              <div className="border-b border-black/8 pb-4 dark:border-white/8">
                <span className="rounded bg-[#c9a75f]/12 px-2.5 py-1 text-[9px] font-bold text-[#936c28] dark:text-[#e0bf73]">
                  {article.category || 'General'}
                </span>
                <h2 className="mt-2 font-serif text-xl font-semibold">{source.title}</h2>
              </div>
              <div
                className="pm-explanation-container pt-5 text-sm leading-relaxed text-slate-800 dark:text-slate-200"
                dangerouslySetInnerHTML={{ __html: article.contentHtml }}
              />
            </article>
          ) : null}
        </div>
      </section>
    </div>
  );
}

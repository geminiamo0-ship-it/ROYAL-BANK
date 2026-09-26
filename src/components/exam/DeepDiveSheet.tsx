'use client';

import React, { type FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowUp, Loader2, MessageCircle, Send, Sparkles, X } from 'lucide-react';
import { DeepDiveLanguageChoice, type DeepDiveLanguage } from './DeepDiveLanguageChoice';
import { DeepDiveMarkdown, type DeepDiveTextDirection } from './DeepDiveMarkdown';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type StartResponse = {
  ok?: boolean;
  threadId?: string;
  initialResponse?: string;
  messages?: ChatMessage[];
  cacheHit?: boolean;
  remaining?: number;
  dailyLimit?: number;
  followupLimit?: number;
  remainingFollowups?: number;
  language?: DeepDiveLanguage;
  supportUrl?: string | null;
  error?: { code?: string; message?: string };
};

type MessageResponse = {
  ok?: boolean;
  assistantResponse?: string;
  remainingFollowups?: number;
  followupLimit?: number;
  language?: DeepDiveLanguage;
  error?: { code?: string; message?: string };
};

const ARABIC_RE = /[\u0600-\u06FF]/g;
const LATIN_RE = /[A-Za-z]/g;

function messageDirection(value: string): 'ltr' | 'rtl' {
  const arabic = (value.match(ARABIC_RE) || []).length;
  const latin = (value.match(LATIN_RE) || []).length;
  return arabic > 0 && arabic >= Math.max(2, Math.floor(latin * 0.2)) ? 'rtl' : 'ltr';
}

export function DeepDiveSheet({ sessionId, questionId }: { sessionId: string; questionId: number }) {
  const [mounted, setMounted] = useState(false);
  const [entered, setEntered] = useState(false);
  const [language, setLanguage] = useState<DeepDiveLanguage | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [initialResponse, setInitialResponse] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [dailyLimit, setDailyLimit] = useState<number | null>(null);
  const [remainingFollowups, setRemainingFollowups] = useState<number | null>(null);
  const [followupLimit, setFollowupLimit] = useState<number | null>(null);
  const [supportUrl, setSupportUrl] = useState<string | null>(null);
  const [cacheHit, setCacheHit] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mounted) return;
    const frame = window.requestAnimationFrame(() => setEntered(true));
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previous;
    };
  }, [mounted]);

  useEffect(() => {
    if (!mounted || !scrollRef.current) return;
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [initialResponse, messages, sending, mounted]);

  async function loadDeepDive(nextLanguage: DeepDiveLanguage) {
    setLanguage(nextLanguage);
    setLoading(true);
    setError(null);
    setLimitReached(false);

    try {
      const response = await fetch('/api/deep-dive', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          sessionId,
          questionId,
          language: nextLanguage,
        }),
      });
      const payload = await response.json() as StartResponse;
      if (!response.ok || !payload.ok) {
        if (payload.error?.code === 'DEEP_DIVE_DAILY_LIMIT') {
          setLimitReached(true);
          setRemaining(0);
          setDailyLimit(payload.dailyLimit ?? null);
          setSupportUrl(payload.supportUrl || null);
          return;
        }
        throw new Error(payload.error?.message || 'Unable to open Deep Dive.');
      }

      setThreadId(payload.threadId || null);
      setInitialResponse(payload.initialResponse || '');
      setMessages(Array.isArray(payload.messages) ? payload.messages : []);
      setCacheHit(payload.cacheHit === true);
      setRemaining(typeof payload.remaining === 'number' ? payload.remaining : null);
      setDailyLimit(typeof payload.dailyLimit === 'number' ? payload.dailyLimit : null);
      const nextFollowupLimit = typeof payload.followupLimit === 'number' ? payload.followupLimit : null;
      setFollowupLimit(nextFollowupLimit);
      setRemainingFollowups(
        typeof payload.remainingFollowups === 'number'
          ? payload.remainingFollowups
          : nextFollowupLimit,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to open Deep Dive.');
    } finally {
      setLoading(false);
    }
  }

  function openSheet() {
    setMounted(true);
  }

  function closeSheet() {
    setEntered(false);
    window.setTimeout(() => setMounted(false), 260);
  }

  async function switchLanguage(nextLanguage: DeepDiveLanguage) {
    if (nextLanguage === language && initialResponse) return;
    await loadDeepDive(nextLanguage);
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();
    if (!message || !threadId || sending) return;

    setSending(true);
    setError(null);
    setInput('');
    setMessages((current) => [...current, { role: 'user', content: message }]);

    try {
      const response = await fetch('/api/deep-dive', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'message',
          threadId,
          requestId: crypto.randomUUID(),
          message,
        }),
      });
      const payload = await response.json() as MessageResponse;
      if (!response.ok || !payload.ok || !payload.assistantResponse) {
        if (payload.error?.code === 'DEEP_DIVE_FOLLOWUP_LIMIT') setRemainingFollowups(0);
        throw new Error(payload.error?.message || 'Unable to continue this Deep Dive.');
      }

      if (typeof payload.remainingFollowups === 'number') setRemainingFollowups(payload.remainingFollowups);
      if (typeof payload.followupLimit === 'number') setFollowupLimit(payload.followupLimit);
      setMessages((current) => [...current, { role: 'assistant', content: payload.assistantResponse as string }]);
    } catch (cause) {
      setMessages((current) => {
        const last = current[current.length - 1];
        return last?.role === 'user' && last.content === message ? current.slice(0, -1) : current;
      });
      setInput(message);
      setError(cause instanceof Error ? cause.message : 'Unable to continue this Deep Dive.');
    } finally {
      setSending(false);
    }
  }

  const initialDirection: DeepDiveTextDirection = language === 'ar' ? 'rtl' : 'ltr';
  const inputDirection = messageDirection(input || (language === 'ar' ? 'ع' : 'A'));

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        aria-label="Open Deep Dive AI tutor"
        title="Deep Dive"
        className="fixed bottom-[calc(78px+env(safe-area-inset-bottom))] right-2.5 z-[130] inline-flex h-7 items-center gap-1 rounded-full border border-[#c9a75f]/40 bg-[#fffdfa]/94 px-2.5 text-[9px] font-semibold text-[#8f6723] shadow-[0_8px_24px_rgba(56,42,18,0.14)] backdrop-blur-md transition duration-200 hover:-translate-y-0.5 hover:border-[#c9a75f]/65 hover:bg-[#fffaf0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c9a75f]/35 dark:border-[#c9a75f]/45 dark:bg-[#151d23]/94 dark:text-[#e4c274] dark:shadow-[0_10px_28px_rgba(0,0,0,0.28)] dark:hover:bg-[#192229] md:bottom-5 md:right-5 md:h-8 md:gap-1.5 md:px-3 md:text-[10px]"
      >
        <span className="grid h-[18px] w-[18px] place-items-center rounded-full border border-[#c9a75f]/24 bg-[#c9a75f]/8 md:h-5 md:w-5">
          <Sparkles className="h-2.5 w-2.5 md:h-3 md:w-3" />
        </span>
        <span>Deep Dive</span>
      </button>

      {mounted ? (
        <div
          className={'fixed inset-0 z-[900] transition duration-300 ' + (entered ? 'bg-[#3d311d]/18 backdrop-blur-[4px] dark:bg-black/55' : 'bg-transparent backdrop-blur-0')}
          role="dialog"
          aria-modal="true"
          aria-label="Deep Dive AI tutor"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeSheet();
          }}
        >
          <section
            className={
              'fixed inset-x-0 bottom-0 flex h-[92dvh] flex-col overflow-hidden rounded-t-[24px] border border-b-0 border-black/10 bg-[#fbf7ef] shadow-[0_-24px_70px_rgba(60,45,20,0.16)] transition duration-[380ms] ease-[cubic-bezier(.22,1,.36,1)] dark:border-white/10 dark:bg-[#11181e] dark:shadow-[0_-24px_70px_rgba(0,0,0,0.4)] sm:inset-y-3 sm:left-auto sm:right-3 sm:h-auto sm:w-[min(650px,46vw)] sm:min-w-[500px] sm:rounded-[24px] sm:border-b ' +
              (entered
                ? 'translate-y-0 opacity-100 sm:translate-x-0'
                : 'translate-y-full opacity-0 sm:translate-x-full sm:translate-y-0')
            }
          >
            <header className="relative z-10 flex min-h-[82px] shrink-0 items-center justify-between gap-3 border-b border-black/8 bg-[#fffdf8]/92 px-4 pt-2 backdrop-blur-xl dark:border-white/8 dark:bg-[#121a20]/94 sm:px-5 sm:pt-0">
              <div className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-black/12 dark:bg-white/18 sm:hidden" />
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#c9a75f]/30 bg-[#c9a75f]/8 text-[#ad7d28] dark:bg-[#c9a75f]/10 dark:text-[#e8c978]">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-serif text-[19px] font-semibold tracking-[-0.02em] text-[#28231d] dark:text-white">
                    Deep Dive
                  </h2>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[8.5px] font-medium text-[#81796e] dark:text-[#8f9aa3]">
                    <span>Royal Bank AI Tutor</span>
                    {remaining != null && dailyLimit != null ? (
                      <span className="rounded-full border border-[#c9a75f]/20 bg-[#c9a75f]/5 px-2 py-0.5 text-[#9d742b] dark:border-white/10 dark:text-[#d7bd82]">
                        {remaining} of {dailyLimit} remaining today
                      </span>
                    ) : null}
                    {cacheHit ? <span className="text-[#49845b] dark:text-[#7fc7a1]">Instant analysis</span> : null}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {language ? (
                  <div className="flex rounded-xl border border-black/8 bg-[#f3ede2] p-1 dark:border-white/8 dark:bg-[#0d1419]">
                    <button
                      type="button"
                      onClick={() => void switchLanguage('en')}
                      disabled={loading}
                      className={'rounded-lg px-2.5 py-1.5 text-[9px] font-bold transition ' + (language === 'en' ? 'bg-[#fffdf8] text-[#9b722a] shadow-sm dark:bg-[#182128] dark:text-[#e5c576]' : 'text-[#8b8377] hover:text-[#4b443b] dark:text-white/38 dark:hover:text-white/70')}
                    >
                      EN
                    </button>
                    <button
                      type="button"
                      onClick={() => void switchLanguage('ar')}
                      disabled={loading}
                      className={'rounded-lg px-2.5 py-1.5 text-[9px] font-bold transition ' + (language === 'ar' ? 'bg-[#fffdf8] text-[#9b722a] shadow-sm dark:bg-[#182128] dark:text-[#e5c576]' : 'text-[#8b8377] hover:text-[#4b443b] dark:text-white/38 dark:hover:text-white/70')}
                    >
                      عربي
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={closeSheet}
                  className="grid h-9 w-9 place-items-center rounded-full text-[#8b8378] transition hover:bg-black/5 hover:text-[#302b24] dark:text-white/50 dark:hover:bg-white/8 dark:hover:text-white"
                  aria-label="Close Deep Dive"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            {!language && !loading ? <DeepDiveLanguageChoice onChoose={(next) => void loadDeepDive(next)} /> : null}

            {language ? (
              <>
                <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5 sm:py-5">
                  {loading ? (
                    <div className="mx-auto flex max-w-[520px] flex-col items-center justify-center py-24 text-center">
                      <div className="relative grid h-12 w-12 place-items-center rounded-2xl border border-[#c9a75f]/30 bg-[#c9a75f]/8 text-[#ad7d28] dark:text-[#e7c878]">
                        <Sparkles className="h-5 w-5" />
                        <span className="absolute inset-0 animate-ping rounded-2xl border border-[#c9a75f]/20" />
                      </div>
                      <p className="mt-4 text-[12.5px] font-semibold text-[#302b24] dark:text-white">
                        {language === 'ar' ? 'بنجهز الـ Deep Dive بتاعك…' : 'Building your Deep Dive…'}
                      </p>
                      <p className="mt-1 text-[9.5px] text-[#8b8378] dark:text-white/35">
                        {language === 'ar'
                          ? 'بنحلل السؤال، إجابتك، والـ official explanation.'
                          : 'Analysing the question, your answer and the official explanation.'}
                      </p>
                    </div>
                  ) : limitReached ? (
                    <div className="mx-auto max-w-[520px] py-16 text-center">
                      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-[#c9a75f]/30 bg-[#c9a75f]/8 text-[#ad7d28] dark:text-[#e7c878]">
                        <MessageCircle className="h-5 w-5" />
                      </div>
                      <h3 className="mt-4 font-serif text-[21px] font-semibold text-[#2d2821] dark:text-white">
                        You’ve used today’s Deep Dives
                      </h3>
                      <p className="mx-auto mt-2 max-w-[430px] text-[11px] leading-5 text-[#7b746a] dark:text-white/48">
                        Your current allowance includes {dailyLimit ?? 4} new Deep Dive sessions per day. Existing conversations stay available.
                      </p>
                      {supportUrl ? (
                        <a
                          href={supportUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-[#c49a46] px-4 text-[11px] font-semibold text-[#16120b] hover:bg-[#d2aa58]"
                        >
                          Contact us on Telegram
                          <ArrowUp className="h-3.5 w-3.5 rotate-45" />
                        </a>
                      ) : null}
                    </div>
                  ) : (
                    <div className="mx-auto w-full max-w-[760px]">
                      {initialResponse ? (
                        <DeepDiveMarkdown
                          content={initialResponse}
                          direction={initialDirection}
                          animateSections
                        />
                      ) : null}

                      {messages.length ? <div className="my-5 border-t border-black/8 dark:border-white/8" /> : null}

                      <div className="space-y-3">
                        {messages.map((message, index) => {
                          const direction = messageDirection(message.content);
                          if (message.role === 'user') {
                            return (
                              <div key={index} className="flex justify-end">
                                <div
                                  dir={direction}
                                  style={{ unicodeBidi: 'plaintext' }}
                                  className="max-w-[82%] rounded-2xl rounded-br-md bg-[#b88a32] px-4 py-3 text-[12px] leading-5.5 text-white shadow-sm"
                                >
                                  {message.content}
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div key={index} className="max-w-[96%] rounded-2xl border border-black/8 bg-[#fffdf8] px-4 py-4 shadow-sm dark:border-white/8 dark:bg-[#151d23]">
                              <DeepDiveMarkdown content={message.content} direction="auto" compact />
                            </div>
                          );
                        })}

                        {sending ? (
                          <div className="inline-flex items-center gap-2 rounded-full border border-black/8 bg-[#fffdf8] px-3 py-2 text-[9.5px] text-[#8b8378] dark:border-white/8 dark:bg-[#151d23] dark:text-white/42">
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#b88a32]" />
                            Thinking…
                          </div>
                        ) : null}
                      </div>

                      {error ? (
                        <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/7 px-3 py-2 text-[10.5px] text-red-700 dark:text-red-200">
                          {error}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>

                {!loading && !limitReached && threadId ? (
                  <div className="shrink-0 border-t border-black/8 bg-[#f8f2e8]/95 px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-3 backdrop-blur-xl dark:border-white/8 dark:bg-[#0f171c]/95 sm:px-4 sm:pb-4">
                    <form onSubmit={sendMessage} className="mx-auto flex max-w-[760px] items-end gap-2">
                      <div className="min-w-0 flex-1 rounded-2xl border border-black/10 bg-[#fffdf8] px-3 py-2 transition focus-within:border-[#b9954d]/55 dark:border-white/10 dark:bg-[#0b1217]">
                        <textarea
                          value={input}
                          dir={inputDirection}
                          onChange={(event) => setInput(event.target.value.slice(0, 2000))}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                              event.preventDefault();
                              event.currentTarget.form?.requestSubmit();
                            }
                          }}
                          rows={1}
                          placeholder={language === 'ar' ? 'اسأل أي follow-up عن السؤال…' : 'Ask a follow-up about this question…'}
                          disabled={sending || remainingFollowups === 0}
                          className={'max-h-28 min-h-[26px] w-full resize-none bg-transparent text-[11.5px] leading-5 text-[#302b24] outline-none placeholder:text-[#a1988b] disabled:opacity-50 dark:text-white dark:placeholder:text-white/28 ' + (inputDirection === 'rtl' ? 'text-right' : 'text-left')}
                        />
                        <div className="mt-1 flex items-center justify-between gap-2 text-[7.5px] text-[#a1988b] dark:text-white/25">
                          <span>{language === 'ar' ? 'نفس السؤال + conversation memory' : 'Same question context and conversation memory'}</span>
                          {remainingFollowups != null && followupLimit != null ? (
                            <span>{remainingFollowups} follow-ups left</span>
                          ) : null}
                        </div>
                      </div>
                      <button
                        type="submit"
                        disabled={!input.trim() || sending || remainingFollowups === 0}
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#c49a46] text-[#16120b] transition hover:bg-[#d3aa57] disabled:cursor-not-allowed disabled:opacity-35"
                        aria-label="Send follow-up"
                      >
                        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      </button>
                    </form>
                    {remainingFollowups === 0 ? (
                      <p className="mx-auto mt-2 max-w-[760px] text-center text-[8.5px] text-[#9a722d] dark:text-[#d7bd82]">
                        This conversation has reached its follow-up limit.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </section>

          <style jsx global>{`
            @keyframes royalDeepDiveSectionIn {
              from { opacity: 0; transform: translateY(9px); }
              to { opacity: 1; transform: translateY(0); }
            }
            @keyframes royalDeepDiveChooserIn {
              from { opacity: 0; transform: translateY(10px) scale(.992); }
              to { opacity: 1; transform: translateY(0) scale(1); }
            }
            .royal-deep-dive-section {
              animation: royalDeepDiveSectionIn .44s cubic-bezier(.22,1,.36,1) both;
            }
            .royal-deep-dive-chooser {
              animation: royalDeepDiveChooserIn .46s .06s cubic-bezier(.22,1,.36,1) both;
            }
          `}</style>
        </div>
      ) : null}
    </>
  );
}

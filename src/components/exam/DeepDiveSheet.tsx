'use client';

import React, { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { ArrowUp, Loader2, MessageCircle, Send, Sparkles, X } from 'lucide-react';

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
  supportUrl?: string | null;
  error?: { code?: string; message?: string };
};

type MessageResponse = {
  ok?: boolean;
  assistantResponse?: string;
  remainingFollowups?: number;
  followupLimit?: number;
  error?: { code?: string; message?: string };
};

function inlineMarkdown(value: string): ReactNode[] {
  return value.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} className="font-semibold text-[#fff8e8]">{part.slice(2, -2)}</strong>;
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

function DeepDiveMarkdown({ content }: { content: string }) {
  return (
    <div className="space-y-2.5 text-[13px] leading-6 text-[#dce3e8] sm:text-[14px]">
      {content.split('\n').map((raw, index) => {
        const line = raw.trim();
        if (!line) return <div key={index} className="h-1" />;
        if (line.startsWith('### ')) {
          return <h4 key={index} className="pt-2 text-[13px] font-semibold text-[#efd497]">{inlineMarkdown(line.slice(4))}</h4>;
        }
        if (line.startsWith('## ')) {
          return <h3 key={index} className="pt-3 font-serif text-[18px] font-semibold tracking-[-0.015em] text-white">{inlineMarkdown(line.slice(3))}</h3>;
        }
        if (/^[-*]\s+/.test(line)) {
          return (
            <div key={index} className="flex gap-2 pl-1">
              <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#c49a46]" />
              <p>{inlineMarkdown(line.replace(/^[-*]\s+/, ''))}</p>
            </div>
          );
        }
        return <p key={index}>{inlineMarkdown(line)}</p>;
      })}
    </div>
  );
}

export function DeepDiveSheet({ sessionId, questionId }: { sessionId: string; questionId: number }) {
  const [mounted, setMounted] = useState(false);
  const [entered, setEntered] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [displayedInitial, setDisplayedInitial] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingReply, setStreamingReply] = useState('');
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [dailyLimit, setDailyLimit] = useState<number | null>(null);
  const [remainingFollowups, setRemainingFollowups] = useState<number | null>(null);
  const [followupLimit, setFollowupLimit] = useState<number | null>(null);
  const [supportUrl, setSupportUrl] = useState<string | null>(null);
  const [cacheHit, setCacheHit] = useState(false);
  const revealTimerRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  function clearRevealTimer() {
    if (revealTimerRef.current != null) {
      window.clearInterval(revealTimerRef.current);
      revealTimerRef.current = null;
    }
  }

  function reveal(text: string, setter: (value: string) => void, onDone?: () => void) {
    clearRevealTimer();
    let cursor = 0;
    setter('');
    const chunk = Math.max(8, Math.min(28, Math.ceil(Math.max(text.length, 1) / 180)));
    revealTimerRef.current = window.setInterval(() => {
      cursor = Math.min(text.length, cursor + chunk);
      setter(text.slice(0, cursor));
      if (cursor >= text.length) {
        clearRevealTimer();
        onDone?.();
      }
    }, 14);
  }

  useEffect(() => () => clearRevealTimer(), []);

  useEffect(() => {
    clearRevealTimer();
    setMounted(false);
    setEntered(false);
    setThreadId(null);
    setDisplayedInitial('');
    setMessages([]);
    setStreamingReply('');
    setInput('');
    setError(null);
    setLimitReached(false);
    setRemaining(null);
    setDailyLimit(null);
    setRemainingFollowups(null);
    setFollowupLimit(null);
    setSupportUrl(null);
    setCacheHit(false);
  }, [sessionId, questionId]);

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
  }, [displayedInitial, messages, streamingReply, mounted]);

  async function loadDeepDive() {
    setLoading(true);
    setError(null);
    setLimitReached(false);
    try {
      const response = await fetch('/api/deep-dive', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'start', sessionId, questionId }),
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
      setMessages(Array.isArray(payload.messages) ? payload.messages : []);
      setCacheHit(payload.cacheHit === true);
      setRemaining(typeof payload.remaining === 'number' ? payload.remaining : null);
      setDailyLimit(typeof payload.dailyLimit === 'number' ? payload.dailyLimit : null);
      const nextFollowupLimit = typeof payload.followupLimit === 'number' ? payload.followupLimit : null;
      setFollowupLimit(nextFollowupLimit);
      setRemainingFollowups(nextFollowupLimit);
      reveal(payload.initialResponse || '', setDisplayedInitial);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to open Deep Dive.');
    } finally {
      setLoading(false);
    }
  }

  function openSheet() {
    setMounted(true);
    if (!threadId && !loading && !limitReached) void loadDeepDive();
  }

  function closeSheet() {
    setEntered(false);
    window.setTimeout(() => setMounted(false), 220);
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
      const assistant = payload.assistantResponse;
      reveal(assistant, setStreamingReply, () => {
        setMessages((current) => [...current, { role: 'assistant', content: assistant }]);
        setStreamingReply('');
      });
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

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#c9a75f]/55 bg-[#c9a75f]/10 px-3 text-[11px] font-semibold text-[#e6c980] transition hover:border-[#d9ba75] hover:bg-[#c9a75f]/16"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Deep Dive
      </button>

      {mounted ? (
        <div
          className={'fixed inset-0 z-[900] flex items-end justify-center transition-colors duration-200 ' + (entered ? 'bg-black/60 backdrop-blur-[2px]' : 'bg-black/0')}
          role="dialog"
          aria-modal="true"
          aria-label="Deep Dive AI tutor"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeSheet();
          }}
        >
          <section
            className={'flex h-[88dvh] w-full max-w-[980px] flex-col overflow-hidden rounded-t-[24px] border border-b-0 border-[#3e454a] bg-[#11171c] shadow-[0_-20px_70px_rgba(0,0,0,0.45)] transition duration-200 ease-out sm:h-[82dvh] sm:w-[calc(100%-32px)] ' + (entered ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0')}
          >
            <div className="shrink-0 border-b border-white/8 bg-[#131a20] px-4 pb-3 pt-2 sm:px-5">
              <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/18" />
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#c9a75f]/30 bg-[#c9a75f]/10 text-[#e8c978]">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-serif text-[18px] font-semibold tracking-[-0.02em] text-white">Deep Dive</h2>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[9px] font-medium text-[#8f9aa3]">
                      <span>Royal Bank AI Tutor</span>
                      {remaining != null && dailyLimit != null ? (
                        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[#d7bd82]">{remaining} of {dailyLimit} remaining today</span>
                      ) : null}
                      {cacheHit ? <span className="text-[#7fc7a1]">Instant analysis</span> : null}
                    </div>
                  </div>
                </div>
                <button type="button" onClick={closeSheet} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/60 hover:bg-white/8 hover:text-white" aria-label="Close Deep Dive">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-7 sm:py-6">
              {loading ? (
                <div className="mx-auto flex max-w-[680px] flex-col items-center justify-center py-20 text-center">
                  <div className="relative grid h-12 w-12 place-items-center rounded-2xl border border-[#c9a75f]/30 bg-[#c9a75f]/8 text-[#e7c878]">
                    <Sparkles className="h-5 w-5" />
                    <span className="absolute inset-0 animate-ping rounded-2xl border border-[#c9a75f]/20" />
                  </div>
                  <p className="mt-4 text-[13px] font-semibold text-white">Building your Deep Dive…</p>
                  <p className="mt-1 text-[10px] text-white/40">Analysing the question, your answer and the official explanation.</p>
                </div>
              ) : limitReached ? (
                <div className="mx-auto max-w-[560px] py-14 text-center">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-[#c9a75f]/30 bg-[#c9a75f]/10 text-[#e7c878]">
                    <MessageCircle className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 font-serif text-[22px] font-semibold text-white">You’ve used today’s Deep Dives</h3>
                  <p className="mx-auto mt-2 max-w-[430px] text-[12px] leading-5 text-white/55">
                    Your current allowance includes {dailyLimit ?? 4} new Deep Dive sessions per day. Your existing conversations stay available.
                  </p>
                  <a
                    href={supportUrl || '/support'}
                    target={supportUrl ? '_blank' : undefined}
                    rel={supportUrl ? 'noreferrer' : undefined}
                    className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-[#c49a46] px-4 text-[12px] font-semibold text-[#16120b] hover:bg-[#d2aa58]"
                  >
                    Contact the Royal Bank team
                    <ArrowUp className="h-3.5 w-3.5 rotate-45" />
                  </a>
                </div>
              ) : (
                <div className="mx-auto max-w-[760px]">
                  {displayedInitial ? (
                    <div className="rounded-2xl border border-white/8 bg-[#151d23] px-4 py-4 shadow-sm sm:px-5 sm:py-5">
                      <DeepDiveMarkdown content={displayedInitial} />
                    </div>
                  ) : null}

                  {messages.map((message, index) => (
                    <div key={index} className={message.role === 'user' ? 'ml-auto mt-4 max-w-[78%]' : 'mt-4 max-w-[94%]'}>
                      {message.role === 'user' ? (
                        <div className="rounded-2xl rounded-br-md bg-[#b88a32] px-4 py-3 text-[13px] leading-5 text-white">{message.content}</div>
                      ) : (
                        <div className="rounded-2xl rounded-bl-md border border-white/8 bg-[#151d23] px-4 py-4"><DeepDiveMarkdown content={message.content} /></div>
                      )}
                    </div>
                  ))}

                  {streamingReply ? (
                    <div className="mt-4 max-w-[94%] rounded-2xl rounded-bl-md border border-white/8 bg-[#151d23] px-4 py-4">
                      <DeepDiveMarkdown content={streamingReply} />
                    </div>
                  ) : null}

                  {sending && !streamingReply ? (
                    <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/8 bg-[#151d23] px-3 py-2 text-[10px] text-white/45">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d1ad60]" />
                      Thinking…
                    </div>
                  ) : null}

                  {error ? <div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/8 px-3 py-2 text-[11px] text-red-200">{error}</div> : null}
                </div>
              )}
            </div>

            {!loading && !limitReached && threadId ? (
              <div className="shrink-0 border-t border-white/8 bg-[#12191e]/95 px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-3 backdrop-blur sm:px-5 sm:pb-4">
                <form onSubmit={sendMessage} className="mx-auto flex max-w-[760px] items-end gap-2">
                  <div className="min-w-0 flex-1 rounded-2xl border border-white/12 bg-[#0d1317] px-3 py-2 focus-within:border-[#b9954d]/65">
                    <textarea
                      value={input}
                      onChange={(event) => setInput(event.target.value.slice(0, 2000))}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }
                      }}
                      rows={1}
                      placeholder="Ask a follow-up about this question…"
                      disabled={sending || remainingFollowups === 0}
                      className="max-h-28 min-h-[26px] w-full resize-none bg-transparent text-[12px] leading-5 text-white outline-none placeholder:text-white/30 disabled:opacity-50"
                    />
                    <div className="mt-1 flex items-center justify-between gap-2 text-[8px] text-white/28">
                      <span>Same question context and conversation memory</span>
                      {remainingFollowups != null && followupLimit != null ? <span>{remainingFollowups} follow-ups left</span> : null}
                    </div>
                  </div>
                  <button type="submit" disabled={!input.trim() || sending || remainingFollowups === 0} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#c49a46] text-[#16120b] transition hover:bg-[#d3aa57] disabled:cursor-not-allowed disabled:opacity-35" aria-label="Send follow-up">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </form>
                {remainingFollowups === 0 ? <p className="mx-auto mt-2 max-w-[760px] text-center text-[9px] text-[#d7bd82]">This conversation has reached its follow-up limit.</p> : null}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}

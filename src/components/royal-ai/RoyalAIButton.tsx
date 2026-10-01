'use client';

import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  BrainCircuit,
  History,
  Loader2,
  MessageSquarePlus,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { DeepDiveMarkdown } from '@/components/exam/DeepDiveMarkdown';
import { RoyalAIHistoryPanel, type RoyalAIConversationSummary } from '@/components/royal-ai/RoyalAIHistoryPanel';

type Language = 'en' | 'ar';

type SourceCard = {
  id: string;
  title: string;
  articleId: string | null;
  score?: number;
};

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceCard[];
  groundingMode?: 'royal' | 'general';
};

type JsonPayload = {
  ok?: boolean;
  language?: Language;
  conversations?: RoyalAIConversationSummary[];
  conversation?: { id: string; title: string; language: Language };
  messages?: Array<{
    role: 'user' | 'assistant';
    content: string;
    sources?: SourceCard[];
  }>;
  conversationId?: string;
  dailyLimit?: number;
  remainingToday?: number;
  error?: { code?: string; message?: string };
};

function direction(text: string): 'rtl' | 'ltr' {
  const arabic = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return arabic > 0 && arabic >= Math.max(2, Math.floor(latin * 0.2)) ? 'rtl' : 'ltr';
}

async function callRoyal(body: Record<string, unknown>): Promise<JsonPayload> {
  const response = await fetch('/api/royal-ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as JsonPayload;
  if (!response.ok || payload.ok === false) {
    throw Object.assign(new Error(payload.error?.message || 'Royal AI request failed.'), {
      code: payload.error?.code,
      payload,
    });
  }
  return payload;
}

export function RoyalAIButton() {
  const [mounted, setMounted] = useState(false);
  const [entered, setEntered] = useState(false);
  const [language, setLanguage] = useState<Language | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<RoyalAIConversationSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [dailyLimit, setDailyLimit] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isEmpty = messages.length === 0;

  useEffect(() => {
    if (!mounted) return;
    const frame = requestAnimationFrame(() => setEntered(true));
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    void initialize();
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previous;
    };
  }, [mounted]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  async function initialize() {
    setError(null);
    try {
      const [preference, usage, list] = await Promise.all([
        callRoyal({ action: 'preferences' }),
        callRoyal({ action: 'usage' }),
        callRoyal({ action: 'list' }),
      ]);
      const saved = preference.language || (localStorage.getItem('royal-ai-language') as Language | null);
      if (saved === 'ar' || saved === 'en') setLanguage(saved);
      setRemaining(typeof usage.remainingToday === 'number' ? usage.remainingToday : null);
      setDailyLimit(typeof usage.dailyLimit === 'number' ? usage.dailyLimit : null);
      setHistory(Array.isArray(list.conversations) ? list.conversations : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to open Royal AI.');
    }
  }

  function open() {
    setMounted(true);
  }

  function close() {
    setEntered(false);
    window.setTimeout(() => setMounted(false), 320);
  }

  async function chooseLanguage(next: Language) {
    setLanguage(next);
    localStorage.setItem('royal-ai-language', next);
    await callRoyal({ action: 'set_language', language: next }).catch(() => undefined);
  }

  async function loadHistory() {
    try {
      const result = await callRoyal({ action: 'list' });
      setHistory(Array.isArray(result.conversations) ? result.conversations : []);
      setHistoryOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load conversations.');
    }
  }

  async function openConversation(id: string) {
    try {
      const result = await callRoyal({ action: 'get', conversationId: id });
      setConversationId(id);
      setLanguage(result.conversation?.language || language || 'en');
      setMessages((result.messages || []).map((message) => ({
        role: message.role,
        content: message.content,
        sources: message.sources || [],
        groundingMode: message.sources?.length ? 'royal' : 'general',
      })));
      setHistoryOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to open conversation.');
    }
  }

  function newChat() {
    setConversationId(null);
    setMessages([]);
    setInput('');
    setError(null);
    setHistoryOpen(false);
  }

  async function deleteConversation(id: string) {
    if (!window.confirm('Delete this conversation?')) return;
    try {
      await callRoyal({ action: 'delete', conversationId: id });
      if (conversationId === id) {
        setConversationId(null);
        setMessages([]);
      }
      await loadHistorySilently();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to delete conversation.');
    }
  }

  async function deleteAll() {
    if (!window.confirm('Delete all Royal AI conversations? This cannot be undone.')) return;
    try {
      await callRoyal({ action: 'delete_all' });
      setConversationId(null);
      setMessages([]);
      setHistory([]);
      setHistoryOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to delete conversations.');
    }
  }

  async function loadHistorySilently() {
    const result = await callRoyal({ action: 'list' }).catch(() => null);
    if (result?.conversations) setHistory(result.conversations);
  }

  async function sendMessage(event?: FormEvent<HTMLFormElement>, suggested?: string) {
    event?.preventDefault();
    const message = (suggested ?? input).trim();
    if (!message || !language || sending) return;

    setSending(true);
    setError(null);
    setStatus(language === 'ar' ? 'بنبحث في مكتبات Royal…' : 'Searching Royal medical libraries…');
    setInput('');
    setMessages((current) => [...current, { role: 'user', content: message }]);

    const assistantIndex = messages.length + 1;
    setMessages((current) => [...current, { role: 'assistant', content: '' }]);

    try {
      const response = await fetch('/api/royal-ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'message',
          conversationId,
          requestId: crypto.randomUUID(),
          message,
          language,
        }),
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({})) as JsonPayload;
        if (typeof payload.remainingToday === 'number') setRemaining(payload.remainingToday);
        if (typeof payload.dailyLimit === 'number') setDailyLimit(payload.dailyLimit);
        throw new Error(payload.error?.message || 'Unable to send message.');
      }

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      let finalSources: SourceCard[] = [];
      let finalGrounding: 'royal' | 'general' = 'general';

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const events = buffer.split(/\n\n/);
        buffer = events.pop() || '';

        for (const raw of events) {
          const eventName = raw.split(/\r?\n/).find((line) => line.startsWith('event:'))?.slice(6).trim();
          const data = raw.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
          if (!eventName || !data) continue;
          const payload = JSON.parse(data) as Record<string, unknown>;

          if (eventName === 'meta') {
            if (typeof payload.conversationId === 'string') setConversationId(payload.conversationId);
            if (typeof payload.remainingToday === 'number') setRemaining(payload.remainingToday);
            if (typeof payload.dailyLimit === 'number') setDailyLimit(payload.dailyLimit);
            finalGrounding = payload.groundingMode === 'royal' ? 'royal' : 'general';
            finalSources = Array.isArray(payload.sources) ? payload.sources as SourceCard[] : [];
            setStatus(language === 'ar' ? 'Royal بيجهز الإجابة…' : 'Royal is preparing the answer…');
          }

          if (eventName === 'token' && typeof payload.text === 'string') {
            setStatus('');
            setMessages((current) => current.map((item, index) =>
              index === assistantIndex ? { ...item, content: item.content + String(payload.text) } : item,
            ));
          }

          if (eventName === 'error') {
            throw new Error(String(payload.message || 'Royal AI response was interrupted.'));
          }
        }
      }

      setMessages((current) => current.map((item, index) =>
        index === assistantIndex ? { ...item, sources: finalSources, groundingMode: finalGrounding } : item,
      ));
      await loadHistorySilently();
    } catch (cause) {
      setMessages((current) => current.filter((_, index) => index !== assistantIndex && index !== assistantIndex - 1));
      setInput(message);
      setError(cause instanceof Error ? cause.message : 'Unable to continue this conversation.');
    } finally {
      setSending(false);
      setStatus('');
    }
  }

  const quickPrompts = useMemo(() => language === 'ar'
    ? ['اشرحلي مفهوم طبي', 'قارن بين مرضين', 'لخصلي موضوع', 'اختبرني في Topic']
    : ['Explain a medical concept', 'Compare two conditions', 'Summarize a topic', 'Quiz me on a topic'],
  [language]);

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label="Open Royal AI"
        title="Royal AI"
        className="fixed bottom-5 right-5 z-[180] grid h-14 w-14 place-items-center rounded-full border border-[#c9a75f]/50 bg-[#171b1d] text-[#e5c476] shadow-[0_14px_36px_rgba(0,0,0,.34),0_0_0_1px_rgba(201,167,95,.08)] transition duration-200 hover:-translate-y-1 hover:border-[#e1c170]/70 hover:shadow-[0_18px_42px_rgba(0,0,0,.4),0_0_24px_rgba(201,167,95,.13)]"
      >
        <BrainCircuit className="h-6 w-6" />
        <span className="sr-only">Royal AI</span>
      </button>

      {mounted ? (
        <div className={'royal-ai-backdrop fixed inset-0 z-[950] ' + (entered ? 'is-entered' : '')}>
          <section className={'royal-ai-surface fixed inset-0 flex flex-col overflow-hidden bg-[#f8f4eb] text-[#2d2923] dark:bg-[#10171c] dark:text-white ' + (entered ? 'is-entered' : '')}>
            <header className="flex h-[66px] shrink-0 items-center justify-between border-b border-black/8 bg-[#fffdf8]/95 px-4 backdrop-blur-xl dark:border-white/8 dark:bg-[#121a20]/95 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-full border border-[#c9a75f]/35 bg-[#c9a75f]/9 text-[#a97a27] dark:text-[#e8c977]">
                  <BrainCircuit className="h-4.5 w-4.5" />
                </div>
                <div>
                  <h2 className="font-serif text-[18px] font-semibold">Royal</h2>
                  <p className="text-[9px] text-[#80786d] dark:text-white/40">Royal AI · Medical Tutor</p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {remaining != null && dailyLimit != null ? (
                  <span className="hidden rounded-full border border-[#c9a75f]/20 px-2.5 py-1 text-[9px] font-semibold text-[#9b722a] dark:text-[#dfc078] sm:inline-flex">
                    {remaining} / {dailyLimit} today
                  </span>
                ) : null}
                <button onClick={newChat} className="grid h-9 w-9 place-items-center rounded-full hover:bg-black/5 dark:hover:bg-white/7" title="New chat">
                  <MessageSquarePlus className="h-4 w-4" />
                </button>
                <button onClick={() => void loadHistory()} className="grid h-9 w-9 place-items-center rounded-full hover:bg-black/5 dark:hover:bg-white/7" title="History">
                  <History className="h-4 w-4" />
                </button>
                <button onClick={close} className="grid h-9 w-9 place-items-center rounded-full hover:bg-black/5 dark:hover:bg-white/7" aria-label="Close Royal AI">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            {!language ? (
              <div className="flex flex-1 items-center justify-center px-5 py-8">
                <div className="w-full max-w-[560px] text-center">
                  <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-[#c9a75f]/35 bg-[#c9a75f]/9 text-[#a97a27] dark:text-[#e8c977]">
                    <BrainCircuit className="h-7 w-7" />
                  </div>
                  <h3 className="mt-5 font-serif text-2xl font-semibold">Meet Royal</h3>
                  <p className="mx-auto mt-2 max-w-[460px] text-[12px] leading-5 text-[#746d63] dark:text-white/45">
                    Grounded in Royal medical libraries and up-to-date medical literature.
                  </p>
                  <div className="mt-7 grid gap-3 sm:grid-cols-2">
                    <button onClick={() => void chooseLanguage('en')} className="rounded-2xl border border-black/10 bg-[#fffdf8] p-5 text-left shadow-sm hover:border-[#c9a75f]/45 dark:border-white/10 dark:bg-[#151d23]">
                      <span className="text-[9px] font-bold uppercase tracking-[.14em] text-[#9a722d]">English</span>
                      <span className="mt-2 block text-sm font-semibold">Professional medical English</span>
                    </button>
                    <button dir="rtl" onClick={() => void chooseLanguage('ar')} className="rounded-2xl border border-black/10 bg-[#fffdf8] p-5 text-right shadow-sm hover:border-[#c9a75f]/45 dark:border-white/10 dark:bg-[#151d23]">
                      <span className="text-[9px] font-bold uppercase tracking-[.14em] text-[#9a722d]">العربية</span>
                      <span className="mt-2 block text-sm font-semibold">عربي + Medical English</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
                  <div className="mx-auto w-full max-w-[840px]">
                    {isEmpty ? (
                      <div className="flex min-h-[62vh] flex-col items-center justify-center text-center">
                        <div className="grid h-14 w-14 place-items-center rounded-full border border-[#c9a75f]/30 bg-[#c9a75f]/8 text-[#ae7e2a] dark:text-[#e6c575]">
                          <Sparkles className="h-5 w-5" />
                        </div>
                        <h3 className="mt-4 font-serif text-[26px] font-semibold">
                          {language === 'ar' ? 'اسأل Royal أي حاجة في الطب' : 'Ask Royal anything in medicine'}
                        </h3>
                        <p className="mt-2 max-w-xl text-[11px] leading-5 text-[#797166] dark:text-white/42">
                          {language === 'ar'
                            ? 'يعتمد على مكتبات Royal والمصادر الطبية المضافة لقاعدة المعرفة.'
                            : 'Grounded in Royal medical libraries and the medical sources in its knowledge base.'}
                        </p>
                        <div className="mt-6 flex max-w-[620px] flex-wrap justify-center gap-2">
                          {quickPrompts.map((prompt) => (
                            <button key={prompt} onClick={() => void sendMessage(undefined, prompt)} className="rounded-full border border-black/10 bg-[#fffdf8] px-3 py-2 text-[10px] font-medium hover:border-[#c9a75f]/40 dark:border-white/10 dark:bg-[#151d23]">
                              {prompt}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {messages.map((message, index) => message.role === 'user' ? (
                          <div key={index} className="flex justify-end">
                            <div dir={direction(message.content)} className="max-w-[82%] rounded-2xl rounded-br-md bg-[#b88a32] px-4 py-3 text-[12.5px] leading-6 text-white">
                              {message.content}
                            </div>
                          </div>
                        ) : (
                          <div key={index} className="rounded-2xl border border-black/8 bg-[#fffdf8] p-4 shadow-sm dark:border-white/8 dark:bg-[#151d23] sm:p-5">
                            {message.content ? <DeepDiveMarkdown content={message.content} direction="auto" compact /> : null}
                            {message.content && (
                              <div className="mt-4 border-t border-black/8 pt-3 dark:border-white/8">
                                <p className="text-[9px] font-semibold text-[#8b8174] dark:text-white/35">
                                  {message.groundingMode === 'royal'
                                    ? '✓ Grounded in Royal sources'
                                    : '○ General medical knowledge'}
                                </p>
                                {message.sources?.length ? (
                                  <details className="mt-2">
                                    <summary className="cursor-pointer text-[10px] font-semibold text-[#9a722d] dark:text-[#e0bf73]">
                                      Sources used · {message.sources.length}
                                    </summary>
                                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                      {message.sources.map((source) => (
                                        <div key={source.id + source.title} className="rounded-xl border border-black/8 bg-black/[.015] px-3 py-2 dark:border-white/8 dark:bg-white/[.025]">
                                          <p className="text-[9px] font-bold text-[#9a722d]">{source.id}</p>
                                          <p className="mt-0.5 text-[10.5px] font-semibold">{source.title}</p>
                                          <p className="mt-0.5 text-[9px] text-[#8a8175] dark:text-white/35">Source used by Royal</p>
                                        </div>
                                      ))}
                                    </div>
                                  </details>
                                ) : null}
                              </div>
                            )}
                          </div>
                        ))}
                        {sending && status ? (
                          <div className="inline-flex items-center gap-2 rounded-full border border-black/8 bg-[#fffdf8] px-3 py-2 text-[10px] text-[#827a70] dark:border-white/8 dark:bg-[#151d23] dark:text-white/42">
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#b88a32]" />
                            {status}
                          </div>
                        ) : null}
                      </div>
                    )}

                    {error ? (
                      <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/8 px-3 py-2 text-[10.5px] text-red-700 dark:text-red-200">{error}</div>
                    ) : null}
                  </div>
                </div>

                <form onSubmit={(event) => void sendMessage(event)} className="shrink-0 border-t border-black/8 bg-[#fffdf8]/95 px-3 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl dark:border-white/8 dark:bg-[#121a20]/95 sm:px-6 sm:pb-4">
                  <div className="mx-auto flex max-w-[840px] items-end gap-2 rounded-2xl border border-black/10 bg-[#f7f1e7] p-2 shadow-sm focus-within:border-[#c9a75f]/45 dark:border-white/10 dark:bg-[#0d1419]">
                    <textarea
                      value={input}
                      onChange={(event) => setInput(event.target.value.slice(0, 4000))}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }
                      }}
                      dir={direction(input || (language === 'ar' ? 'ع' : 'A'))}
                      rows={1}
                      placeholder={language === 'ar' ? 'اسأل Royal…' : 'Ask Royal…'}
                      className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[12.5px] outline-none placeholder:text-[#9c9388] dark:placeholder:text-white/28"
                      disabled={sending}
                    />
                    <button type="submit" disabled={sending || !input.trim()} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#b88a32] text-white hover:bg-[#a97927] disabled:opacity-40">
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mx-auto mt-1.5 flex max-w-[840px] items-center justify-between px-1 text-[8.5px] text-[#958c80] dark:text-white/28">
                    <span>Royal may make mistakes. Verify critical clinical decisions.</span>
                    {remaining != null && dailyLimit != null ? <span>{remaining}/{dailyLimit} today</span> : null}
                  </div>
                </form>
              </>
            )}

            {historyOpen ? (
              <RoyalAIHistoryPanel
                conversations={history}
                onClose={() => setHistoryOpen(false)}
                onOpen={(id) => void openConversation(id)}
                onDelete={(id) => void deleteConversation(id)}
                onDeleteAll={() => void deleteAll()}
              />
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}

'use client';

import { FormEvent, useState, useTransition } from 'react';
import { Loader2, Save, Sparkles } from 'lucide-react';
import { updateRoyalAiAdminConfig, type RoyalAiAdminOverview } from '@/actions/royal-ai-admin';

const inputClass =
  'mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-white';

export function RoyalAiAdminConfig({ config }: { config: RoyalAiAdminOverview['config'] }) {
  const [primaryModel, setPrimaryModel] = useState(config.primary_model || '');
  const [fallbackModel, setFallbackModel] = useState(config.fallback_model || '');
  const [temperature, setTemperature] = useState(String(config.temperature ?? 0.2));
  const [maxOutputTokens, setMaxOutputTokens] = useState(String(config.max_output_tokens ?? 1200));
  const [timeoutMs, setTimeoutMs] = useState(String(config.timeout_ms ?? 170000));
  const [dailyLimit, setDailyLimit] = useState(String(config.default_daily_limit ?? 15));
  const [maxMessageChars, setMaxMessageChars] = useState(String(config.max_message_chars ?? 4000));
  const [retrievalCandidates, setRetrievalCandidates] = useState(String(config.retrieval_candidates ?? 20));
  const [retrievalFinal, setRetrievalFinal] = useState(String(config.retrieval_final ?? 8));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await updateRoyalAiAdminConfig({
        primaryModel,
        fallbackModel,
        temperature: Number(temperature),
        maxOutputTokens: Number(maxOutputTokens),
        timeoutMs: Number(timeoutMs),
        defaultDailyLimit: Number(dailyLimit),
        maxMessageChars: Number(maxMessageChars),
        retrievalCandidates: Number(retrievalCandidates),
        retrievalFinal: Number(retrievalFinal),
      });
      if (!result.ok) return setError(result.error);
      setMessage('Royal AI configuration saved. Serving Workers refresh it within about one minute.');
    });
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-300">
          <Sparkles className="h-4 w-4" />
        </div>
        <div>
          <h2 className="font-bold text-slate-900 dark:text-white">Live Royal AI configuration</h2>
          <p className="mt-1 text-[10px] leading-4 text-slate-500">Same model-control pattern as Deep Dive. No application deploy is required for model or quota changes.</p>
        </div>
      </div>

      {error ? <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div> : null}
      {message ? <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">{message}</div> : null}

      <form onSubmit={save} className="mt-5 space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Primary AI model" value={primaryModel} setValue={setPrimaryModel} pending={pending} />
          <Field label="Fallback model" value={fallbackModel} setValue={setFallbackModel} pending={pending} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <NumberField label="Temperature" value={temperature} setValue={setTemperature} min="0" max="1" step="0.05" pending={pending} />
          <NumberField label="Max output tokens" value={maxOutputTokens} setValue={setMaxOutputTokens} min="300" max="4000" step="100" pending={pending} />
          <NumberField label="Timeout (ms)" value={timeoutMs} setValue={setTimeoutMs} min="5000" max="170000" step="1000" pending={pending} />
          <NumberField label="Messages / day" value={dailyLimit} setValue={setDailyLimit} min="1" max="1000" step="1" pending={pending} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField label="Max message chars" value={maxMessageChars} setValue={setMaxMessageChars} min="500" max="12000" step="100" pending={pending} />
          <NumberField label="Retrieval candidates" value={retrievalCandidates} setValue={setRetrievalCandidates} min="5" max="50" step="1" pending={pending} />
          <NumberField label="Final Royal sources" value={retrievalFinal} setValue={setRetrievalFinal} min="1" max="12" step="1" pending={pending} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <p className="text-[10px] text-slate-400">Prompt version: <span className="font-mono font-semibold text-slate-600 dark:text-slate-300">{config.prompt_version}</span></p>
          <button type="submit" disabled={pending} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-purple-600 px-4 text-[10px] font-bold text-white hover:bg-purple-700 disabled:opacity-50">
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save Royal AI config
          </button>
        </div>
      </form>
    </section>
  );
}

function Field({ label, value, setValue, pending }: { label: string; value: string; setValue: (value: string) => void; pending: boolean }) {
  return <label className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">{label}<input value={value} onChange={(e) => setValue(e.target.value)} className={inputClass} disabled={pending} /></label>;
}

function NumberField({ label, value, setValue, min, max, step, pending }: { label: string; value: string; setValue: (value: string) => void; min: string; max: string; step: string; pending: boolean }) {
  return <label className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">{label}<input type="number" value={value} onChange={(e) => setValue(e.target.value)} min={min} max={max} step={step} className={inputClass} disabled={pending} /></label>;
}

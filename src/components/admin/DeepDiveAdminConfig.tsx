'use client';

import { FormEvent, useState, useTransition } from 'react';
import { Loader2, Save, Sparkles } from 'lucide-react';
import {
  updateDeepDiveAdminConfig,
  type DeepDiveAdminOverview,
} from '@/actions/deep-dive-admin';

const inputClass =
  'mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-white';

export function DeepDiveAdminConfig({
  config,
}: {
  config: DeepDiveAdminOverview['config'];
}) {
  const [primaryModel, setPrimaryModel] = useState(config.primary_model || '');
  const [fallbackModel, setFallbackModel] = useState(config.fallback_model || '');
  const [temperature, setTemperature] = useState(String(config.temperature ?? 0.2));
  const [maxInitialTokens, setMaxInitialTokens] = useState(String(config.max_initial_tokens ?? 1800));
  const [maxFollowupTokens, setMaxFollowupTokens] = useState(String(config.max_followup_tokens ?? 900));
  const [timeoutMs, setTimeoutMs] = useState(String(config.timeout_ms ?? 30000));
  const [dailyLimit, setDailyLimit] = useState(String(config.default_daily_limit ?? 4));
  const [followupLimit, setFollowupLimit] = useState(String(config.default_followup_limit ?? 12));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await updateDeepDiveAdminConfig({
        primaryModel,
        fallbackModel,
        temperature: Number(temperature),
        maxInitialTokens: Number(maxInitialTokens),
        maxFollowupTokens: Number(maxFollowupTokens),
        timeoutMs: Number(timeoutMs),
        defaultDailyLimit: Number(dailyLimit),
        defaultFollowupLimit: Number(followupLimit),
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setMessage('AI configuration saved. Cloudflare refreshes the live config within about one minute.');
    });
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-300">
          <Sparkles className="h-4 w-4" />
        </div>
        <div>
          <h2 className="font-bold text-slate-900 dark:text-white">Live model configuration</h2>
          <p className="mt-1 text-[10px] leading-4 text-slate-500">
            Stored as the canonical AI configuration and mirrored to the serving layer. Model changes require no app deploy.
          </p>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          {message}
        </div>
      ) : null}

      <form onSubmit={save} className="mt-5 space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
            Primary AI model
            <input value={primaryModel} onChange={(e) => setPrimaryModel(e.target.value)} className={inputClass} disabled={pending} />
          </label>
          <label className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
            Fallback model
            <input value={fallbackModel} onChange={(e) => setFallbackModel(e.target.value)} className={inputClass} disabled={pending} />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <NumberField label="Temperature" value={temperature} setValue={setTemperature} min="0" max="1" step="0.05" pending={pending} />
          <NumberField label="Initial max tokens" value={maxInitialTokens} setValue={setMaxInitialTokens} min="300" max="4000" step="100" pending={pending} />
          <NumberField label="Follow-up max tokens" value={maxFollowupTokens} setValue={setMaxFollowupTokens} min="200" max="2500" step="100" pending={pending} />
          <NumberField label="Timeout (ms)" value={timeoutMs} setValue={setTimeoutMs} min="5000" max="55000" step="1000" pending={pending} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField label="Default Deep Dives / day" value={dailyLimit} setValue={setDailyLimit} min="1" max="100" step="1" pending={pending} />
          <NumberField label="Default follow-ups / thread" value={followupLimit} setValue={setFollowupLimit} min="1" max="100" step="1" pending={pending} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <p className="text-[10px] text-slate-400">
            Prompt version: <span className="font-mono font-semibold text-slate-600 dark:text-slate-300">{config.prompt_version}</span>
          </p>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-purple-600 px-4 text-[10px] font-bold text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save AI config
          </button>
        </div>
      </form>
    </section>
  );
}

function NumberField({
  label,
  value,
  setValue,
  min,
  max,
  step,
  pending,
}: {
  label: string;
  value: string;
  setValue: (value: string) => void;
  min: string;
  max: string;
  step: string;
  pending: boolean;
}) {
  return (
    <label className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
      {label}
      <input
        type="number"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        min={min}
        max={max}
        step={step}
        className={inputClass}
        disabled={pending}
      />
    </label>
  );
}

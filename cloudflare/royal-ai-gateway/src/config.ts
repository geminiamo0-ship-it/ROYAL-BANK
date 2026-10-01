import type { RoyalAiEnv } from './env';
import { normalizedSupabaseUrl } from './auth';

export type RoyalAiConfig = {
  primaryModel: string;
  fallbackModel: string | null;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  dailyLimit: number;
  maxMessageChars: number;
  retrievalCandidates: number;
  retrievalFinal: number;
  promptVersion: string;
};

export const DEFAULT_ROYAL_AI_CONFIG: RoyalAiConfig = {
  primaryModel: 'deepseek/deepseek-v4.1-flash',
  fallbackModel: 'deepseek/deepseek-v4-pro-0813',
  temperature: 0.2,
  maxOutputTokens: 1200,
  timeoutMs: 170_000,
  dailyLimit: 15,
  maxMessageChars: 4000,
  retrievalCandidates: 20,
  retrievalFinal: 8,
  promptVersion: 'royal_ai_v1_grounded_chat',
};

let cached: { value: RoyalAiConfig; expiresAt: number } | null = null;

function num(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export async function getRoyalAiConfig(env: RoyalAiEnv): Promise<RoyalAiConfig> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const url = new URL(normalizedSupabaseUrl(env) + '/rest/v1/ai_royal_tutor_config');
    url.searchParams.set('active', 'eq.true');
    url.searchParams.set('select', '*');
    url.searchParams.set('limit', '1');
    const response = await fetch(url, {
      headers: {
        apikey: env.SUPABASE_SECRET_KEY,
        authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY,
        accept: 'application/json',
      },
    });
    if (!response.ok) throw new Error('CONFIG_FETCH_FAILED');
    const rows = await response.json<Array<Record<string, unknown>>>();
    const row = rows[0];
    if (!row) throw new Error('CONFIG_NOT_FOUND');

    const value: RoyalAiConfig = {
      primaryModel:
        typeof row.primary_model === 'string' && row.primary_model.trim()
          ? row.primary_model.trim()
          : DEFAULT_ROYAL_AI_CONFIG.primaryModel,
      fallbackModel:
        typeof row.fallback_model === 'string' && row.fallback_model.trim()
          ? row.fallback_model.trim()
          : null,
      temperature: num(row.temperature, DEFAULT_ROYAL_AI_CONFIG.temperature, 0, 1),
      maxOutputTokens: Math.round(
        num(row.max_output_tokens, DEFAULT_ROYAL_AI_CONFIG.maxOutputTokens, 300, 4000),
      ),
      timeoutMs: Math.round(num(row.timeout_ms, DEFAULT_ROYAL_AI_CONFIG.timeoutMs, 5000, 170000)),
      dailyLimit: Math.round(num(row.default_daily_limit, DEFAULT_ROYAL_AI_CONFIG.dailyLimit, 1, 1000)),
      maxMessageChars: Math.round(
        num(row.max_message_chars, DEFAULT_ROYAL_AI_CONFIG.maxMessageChars, 500, 12000),
      ),
      retrievalCandidates: Math.round(
        num(row.retrieval_candidates, DEFAULT_ROYAL_AI_CONFIG.retrievalCandidates, 5, 50),
      ),
      retrievalFinal: Math.round(
        num(row.retrieval_final, DEFAULT_ROYAL_AI_CONFIG.retrievalFinal, 1, 12),
      ),
      promptVersion:
        typeof row.prompt_version === 'string' && row.prompt_version.trim()
          ? row.prompt_version.trim()
          : DEFAULT_ROYAL_AI_CONFIG.promptVersion,
    };
    cached = { value, expiresAt: Date.now() + 60_000 };
    return value;
  } catch (error) {
    console.error('ROYAL_AI_CONFIG_FETCH_FAILED', error);
    cached = { value: DEFAULT_ROYAL_AI_CONFIG, expiresAt: Date.now() + 15_000 };
    return DEFAULT_ROYAL_AI_CONFIG;
  }
}

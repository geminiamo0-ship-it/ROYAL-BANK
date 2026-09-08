import 'server-only';

export const ROYAL_AUTH_COOKIE_NAME = 'royal-auth';

type SupabaseServerConfig = {
  url: string;
  publishableKey: string;
};

function firstEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return '';
}

export function getSupabaseServerConfig(): SupabaseServerConfig {
  return {
    // Legacy NEXT_PUBLIC_* fallbacks are server-only compatibility shims for rollout.
    // Remove them from Vercel after SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY are set.
    url: firstEnv('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'),
    publishableKey: firstEnv(
      'SUPABASE_PUBLISHABLE_KEY',
      'SUPABASE_ANON_KEY',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    ),
  };
}

export function isSupabaseServerConfigured(): boolean {
  const { url, publishableKey } = getSupabaseServerConfig();
  return Boolean(url && publishableKey);
}

export function requireSupabaseServerConfig(): SupabaseServerConfig {
  const config = getSupabaseServerConfig();
  if (!config.url || !config.publishableKey) {
    throw new Error('Authentication service is not configured.');
  }
  return config;
}

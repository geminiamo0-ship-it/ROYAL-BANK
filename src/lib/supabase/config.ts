export function isSupabaseConfigured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  return Boolean(
    url &&
      anonKey &&
      !url.includes('YOUR_PROJECT_REF') &&
      !url.includes('your-project') &&
      !anonKey.includes('your-anon-key')
  );
}

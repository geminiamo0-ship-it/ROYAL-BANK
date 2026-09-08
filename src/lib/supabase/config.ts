import 'server-only';

import { getSupabaseServerConfig } from '@/lib/supabase/env';

export function isSupabaseConfigured() {
  const { url, publishableKey } = getSupabaseServerConfig();

  return Boolean(
    url &&
      publishableKey &&
      !url.includes('YOUR_PROJECT_REF') &&
      !url.includes('your-project') &&
      !publishableKey.includes('your-anon-key') &&
      !publishableKey.includes('placeholder')
  );
}

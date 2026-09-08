import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { getSupabaseServerConfig } from '@/lib/supabase/env';

function requireServiceRoleKey(): string {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!value) {
    throw new Error('Missing required server environment variable: SUPABASE_SERVICE_ROLE_KEY');
  }
  return value;
}

export function createAdminClient() {
  const { url } = getSupabaseServerConfig();
  if (!url) {
    throw new Error('Missing required server environment variable: SUPABASE_URL');
  }

  return createClient(url, requireServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

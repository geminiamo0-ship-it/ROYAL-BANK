import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { requireSupabaseServerConfig } from '@/lib/supabase/env';
import { getRoyalAuthCookieOptions, hardenAuthCookie } from '@/lib/supabase/session-cookies';

export async function createClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = requireSupabaseServerConfig();

  return createServerClient(url, publishableKey, {
    cookieOptions: getRoyalAuthCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, hardenAuthCookie(options));
          });
        } catch {
          // Server Components cannot mutate cookies. Middleware refreshes sessions.
        }
      },
    },
  });
}

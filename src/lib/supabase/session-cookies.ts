import 'server-only';

import type { CookieOptions } from '@supabase/ssr';
import { ROYAL_AUTH_COOKIE_NAME } from '@/lib/supabase/env';

export function hardenAuthCookie(options: CookieOptions = {}): CookieOptions {
  return {
    ...options,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  };
}

export function getRoyalAuthCookieOptions(): CookieOptions & { name: string } {
  return {
    name: ROYAL_AUTH_COOKIE_NAME,
    ...hardenAuthCookie(),
  };
}

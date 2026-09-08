import type { EmailOtpType } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return '/dashboard';
  }

  try {
    const base = new URL('https://royalbank.local');
    const target = new URL(value, base);
    if (target.origin !== base.origin) return '/dashboard';
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return '/dashboard';
  }
}

function noStoreRedirect(url: URL) {
  const response = NextResponse.redirect(url, { status: 303 });
  response.headers.set('cache-control', 'private, no-store');
  response.headers.set('pragma', 'no-cache');
  return response;
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const type = request.nextUrl.searchParams.get('type') as EmailOtpType | null;
  const next = safeNextPath(request.nextUrl.searchParams.get('next'));

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });

    if (!error) {
      return noStoreRedirect(new URL(next, request.url));
    }
  }

  const errorUrl = new URL('/login', request.url);
  errorUrl.searchParams.set('confirmation', 'failed');
  return noStoreRedirect(errorUrl);
}

'use server';

import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { redirect } from 'next/navigation';

function safeInternalRedirect(value: FormDataEntryValue | null): string {
  if (typeof value !== 'string') return '/dashboard';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
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

function getConfirmationRedirectUrl(): string | undefined {
  const appUrl = process.env.ROYAL_APP_URL?.trim();
  if (!appUrl) return undefined;

  try {
    return new URL('/auth/confirm', appUrl).toString();
  } catch {
    return undefined;
  }
}

function publicAuthError(message: string, fallback: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('invalid login credentials')) return 'Invalid email or password.';
  if (normalized.includes('email not confirmed')) return 'Please confirm your email before signing in.';
  if (normalized.includes('user already registered')) return 'An account with this email already exists.';
  if (normalized.includes('password')) return message.replace(/supabase/gi, 'authentication service');
  return fallback;
}

export async function login(formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const redirectPath = safeInternalRedirect(formData.get('redirect'));

  if (!email || !password) {
    return { error: 'Please provide both email and password.' };
  }

  if (!isSupabaseConfigured()) {
    return { error: 'Authentication service is not configured.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: publicAuthError(error.message, 'Unable to sign in. Please try again.') };
  }

  redirect(redirectPath);
}

export async function register(formData: FormData) {
  const fullName = formData.get('fullName') as string;
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (!email || !password) {
    return { error: 'Email and password are required.' };
  }

  if (password.length < 6) {
    return { error: 'Password must be at least 6 characters long.' };
  }

  if (!isSupabaseConfigured()) {
    return { error: 'Authentication service is not configured.' };
  }

  const supabase = await createClient();
  const emailRedirectTo = getConfirmationRedirectUrl();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      ...(emailRedirectTo ? { emailRedirectTo } : {}),
      data: {
        full_name: fullName || splitEmail(email),
      },
    },
  });

  if (error) {
    return { error: publicAuthError(error.message, 'Unable to create your account. Please try again.') };
  }

  if (!data.session) {
    redirect('/login?registered=check-email');
  }

  redirect('/dashboard');
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

export async function getCurrentUser() {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  return profile || null;
}

function splitEmail(email: string): string {
  return email.split('@')[0] || 'Medical Student';
}

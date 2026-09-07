'use server';

import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { redirect } from 'next/navigation';

function safeInternalRedirect(value: FormDataEntryValue | null): string {
  if (typeof value !== 'string') return '/dashboard';
  if (!value.startsWith('/') || value.startsWith('//')) return '/dashboard';
  return value;
}

export async function login(formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const redirectPath = safeInternalRedirect(formData.get('redirect'));

  if (!email || !password) {
    return { error: 'Please provide both email and password.' };
  }

  if (!isSupabaseConfigured()) {
    return { error: 'Supabase is not linked yet. Add your project URL and anon key to .env.local.' };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message };
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
    return { error: 'Supabase is not linked yet. Add your project URL and anon key to .env.local.' };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName || splitEmail(email),
      },
    },
  });

  if (error) {
    return { error: error.message };
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
  const { data: { user } } = await supabase.auth.getUser();

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

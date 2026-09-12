import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { RoyalThemeToggle } from '@/components/theme/RoyalThemeToggle';

export default async function SupportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?redirect=/support');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role,is_active')
    .eq('id', user.id)
    .single();

  if (!profile?.is_active || !['admin', 'support'].includes(profile.role)) {
    redirect('/dashboard');
  }

  return (
    <div className="relative min-h-screen">
      <div className="fixed right-4 top-4 z-50 sm:right-6 sm:top-6">
        <RoyalThemeToggle className="shadow-lg" />
      </div>
      {children}
    </div>
  );
}

import React from 'react';
import { StudentShell } from '@/components/layout/StudentShell';
import { createClient } from '@/lib/supabase/server';

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  // Protected student routes are authenticated authoritatively in middleware.
  // The shell only needs presentation metadata, so read it from the already
  // validated cookie-backed session instead of adding a PostgREST round-trip on
  // every page render. No authorization decision is based on these values.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const userEmail = session?.user.email || 'student@royalbank.com';
  const fullName = session?.user.user_metadata?.full_name;
  const userName = typeof fullName === 'string' && fullName.trim() ? fullName.trim() : 'Doctor';

  return (
    <StudentShell userEmail={userEmail} userName={userName}>
      {children}
    </StudentShell>
  );
}

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
  // The shell only needs presentation metadata, so verify the cookie-backed JWT
  // locally and read display claims from it. This avoids both an extra PostgREST
  // round-trip and trusting the unverified user object returned by getSession().
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  const userEmail =
    typeof claims?.email === 'string' && claims.email.trim()
      ? claims.email.trim()
      : 'student@royalbank.com';

  const userMetadata =
    claims?.user_metadata && typeof claims.user_metadata === 'object'
      ? claims.user_metadata
      : null;
  const fullName = userMetadata && 'full_name' in userMetadata ? userMetadata.full_name : undefined;
  const userName = typeof fullName === 'string' && fullName.trim() ? fullName.trim() : 'Doctor';

  return (
    <StudentShell userEmail={userEmail} userName={userName}>
      {children}
    </StudentShell>
  );
}

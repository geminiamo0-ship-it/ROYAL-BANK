import React from 'react';
import { StudentShell } from '@/components/layout/StudentShell';
import { createClient } from '@/lib/supabase/server';

type StudentShellProfile = {
  email?: string | null;
  full_name?: string | null;
};

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data } = await supabase.rpc('get_my_student_shell_profile');
  const profile = data && typeof data === 'object' && !Array.isArray(data)
    ? (data as StudentShellProfile)
    : null;
  const userEmail = profile?.email || 'student@royalbank.com';
  const userName = profile?.full_name || 'Doctor';

  return (
    <StudentShell userEmail={userEmail} userName={userName}>
      {children}
    </StudentShell>
  );
}

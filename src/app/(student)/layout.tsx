import React from 'react';
import { getCurrentUser } from '@/actions/auth';
import { StudentShell } from '@/components/layout/StudentShell';

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentUser();
  const userEmail = profile?.email || 'student@royalbank.com';
  const userName = profile?.full_name || 'Doctor';

  return (
    <StudentShell userEmail={userEmail} userName={userName}>
      {children}
    </StudentShell>
  );
}

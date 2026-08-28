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
  const subscriptionTier = profile?.subscription_tier || 'free_trial';
  const isAdmin = profile?.role === 'admin';
  const isSupport = profile?.role === 'support';

  return (
    <StudentShell
      userEmail={userEmail}
      userName={userName}
      subscriptionTier={subscriptionTier}
      isAdmin={isAdmin}
      isSupport={isSupport}
    >
      {children}
    </StudentShell>
  );
}

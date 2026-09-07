'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { ExamRateLimitNotice } from '@/components/exam/ExamRateLimitNotice';
import { PassMedicineSidebar } from '@/components/layout/PassMedicineSidebar';
import { StudentHeader } from '@/components/layout/StudentHeader';
import { UpgradeModal } from '@/components/layout/UpgradeModal';

interface StudentShellProps {
  children: React.ReactNode;
  userEmail: string;
  userName: string;
  subscriptionTier: string;
  isAdmin: boolean;
  isSupport: boolean;
}

export function StudentShell({
  children,
  userEmail,
  userName,
  subscriptionTier,
  isAdmin,
  isSupport,
}: StudentShellProps) {
  const pathname = usePathname();
  const isExamRoute = pathname.startsWith('/exam/');

  if (isExamRoute) {
    return (
      <div className="min-h-screen bg-[#282828] text-white">
        <ExamRateLimitNotice />
        <main className="min-h-screen">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#282828] text-white">
      <ExamRateLimitNotice />
      <PassMedicineSidebar currentPathwayName="MRCP Part 1" />

      <div className="flex min-w-0 flex-1 flex-col">
        <StudentHeader
          userEmail={userEmail}
          userName={userName}
          subscriptionTier={subscriptionTier}
          isAdmin={isAdmin}
          isSupport={isSupport}
        />

        <main className="flex-1 overflow-y-auto px-4 pb-8 pt-4">
          {children}
        </main>
      </div>

      <UpgradeModal />
    </div>
  );
}

'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { ExamRateLimitNotice } from '@/components/exam/ExamRateLimitNotice';
import { PassMedicineSidebar } from '@/components/layout/PassMedicineSidebar';
import { StudentHeader } from '@/components/layout/StudentHeader';

interface StudentShellProps {
  children: React.ReactNode;
  userEmail: string;
  userName: string;
}

export function StudentShell({ children, userEmail, userName }: StudentShellProps) {
  const pathname = usePathname();
  const isExamRoute = pathname.startsWith('/exam/');

  if (isExamRoute) {
    return <div className="min-h-screen bg-[#282828] text-white"><ExamRateLimitNotice /><main className="min-h-screen">{children}</main></div>;
  }

  return (
    <div className="flex min-h-screen bg-[#282828] text-white">
      <ExamRateLimitNotice />
      <PassMedicineSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <StudentHeader userEmail={userEmail} userName={userName} />
        <main className="flex-1 overflow-y-auto px-4 pb-8 pt-4">{children}</main>
      </div>
    </div>
  );
}

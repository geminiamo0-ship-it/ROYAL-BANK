import React from 'react';
import { SupportActivationClient } from '@/components/business/SupportActivationClient';
import { SupportDeepDiveAllowance } from '@/components/business/SupportDeepDiveAllowance';

export default function SupportDeskPage() {
  return (
    <div className="min-h-screen bg-[#07101d] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px] space-y-5">
        <SupportDeepDiveAllowance />
      </div>
      <SupportActivationClient />
    </div>
  );
}

import React from 'react';
import { RoyalThemeToggle } from '@/components/theme/RoyalThemeToggle';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen">
      <div className="fixed right-4 top-4 z-50 sm:right-6 sm:top-6">
        <RoyalThemeToggle className="shadow-lg" />
      </div>
      {children}
    </div>
  );
}

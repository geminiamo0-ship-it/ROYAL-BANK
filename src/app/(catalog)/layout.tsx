import React from 'react';
import { RoyalThemeToggle } from '@/components/theme/RoyalThemeToggle';

export default function CatalogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen">
      {children}
      <div className="fixed bottom-5 right-5 z-50 sm:bottom-6 sm:right-6">
        <RoyalThemeToggle className="shadow-lg" />
      </div>
    </div>
  );
}

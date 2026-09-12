'use client';

import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

export function RoyalThemeToggle({ className = '' }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === 'dark';

  if (!mounted) {
    return (
      <span
        aria-hidden="true"
        className={`inline-flex h-8 w-8 rounded-md border border-[#dfd6c8] bg-[#fffdfa] dark:border-[#46515a] dark:bg-[#30373d] ${className}`}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#dfd6c8] bg-[#fffdfa] text-[#9a6d24] shadow-sm transition hover:border-[#c9b183] hover:bg-[#f7f0e4] dark:border-[#46515a] dark:bg-[#30373d] dark:text-[#c1cbd2] dark:hover:border-[#66737d] dark:hover:bg-[#3a4248] dark:hover:text-white ${className}`}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Light theme' : 'Dark theme'}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

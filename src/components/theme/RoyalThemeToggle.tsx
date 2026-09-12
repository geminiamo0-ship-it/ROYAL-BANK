'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

export function RoyalThemeToggle({ className = '' }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#dfd6c8] bg-[#fffdfa] text-[#9a6d24] shadow-sm transition hover:border-[#c9b183] hover:bg-[#f7f0e4] dark:border-[#46515a] dark:bg-[#30373d] dark:text-[#c1cbd2] dark:hover:border-[#66737d] dark:hover:bg-[#3a4248] dark:hover:text-white ${className}`}
      aria-label="Toggle color theme"
      title="Toggle color theme"
    >
      <Moon className="h-4 w-4 dark:hidden" aria-hidden="true" />
      <Sun className="hidden h-4 w-4 dark:block" aria-hidden="true" />
    </button>
  );
}

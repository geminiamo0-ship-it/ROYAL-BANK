'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUIStore } from '@/stores/uiStore';
import { logout } from '@/actions/auth';
import { Crown, Menu, LogOut, Search, TicketCheck, UserCircle } from 'lucide-react';

interface StudentHeaderProps {
  userEmail?: string;
  userName?: string;
}

export function StudentHeader({
  userEmail = 'doctor@royalbank.com',
  userName = 'Doctor',
}: StudentHeaderProps) {
  const { toggleSidebar } = useUIStore();
  const pathname = usePathname();
  const bankMatch = pathname.match(/^\/bank\/(\d+)/);
  const upgradeHref = bankMatch ? `/upgrade?bank=${bankMatch[1]}` : '/upgrade';

  return (
    <header className="sticky top-0 z-30 flex h-[58px] items-center justify-between bg-[#282828] px-6 text-white">
      <div className="flex w-24 items-center">
        <button
          onClick={toggleSidebar}
          className="rounded p-1.5 text-[#9aa3aa] hover:bg-[#343434] hover:text-white"
          title="Toggle Navigation Sidebar"
        >
          <Menu className="h-4 w-4" />
        </button>
      </div>

      <div className="hidden w-[360px] items-center sm:flex">
        <input
          type="search"
          aria-label="Search"
          className="h-6 flex-1 rounded-l-[2px] border border-[#c7cfd6] bg-[#2d2d2d] px-2 text-[12px] text-white outline-none focus:border-white"
        />
        <button
          type="button"
          className="flex h-6 w-28 items-center justify-center rounded-r-[2px] bg-[#ececec] text-[#9aa0a6]"
          title="Search"
        >
          <Search className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center justify-end gap-3">
        <Link
          href={upgradeHref}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-amber-400 px-2.5 text-[11px] font-bold text-[#2c2512] hover:bg-amber-300"
        >
          <Crown className="h-3.5 w-3.5" />
          Upgrade
        </Link>
        <Link
          href="/partner"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#9aa3aa] hover:bg-[#343434] hover:text-white"
          title="My Royal Coupon"
          aria-label="My Royal Coupon"
        >
          <TicketCheck className="h-4 w-4" />
        </Link>
        <div className="hidden text-right leading-tight md:block">
          <p className="max-w-[95px] truncate text-[11px] font-semibold text-white">{userName}</p>
          <p className="max-w-[95px] truncate text-[10px] text-[#b7c0c8]">{userEmail}</p>
        </div>
        <UserCircle className="h-8 w-8 text-[#b7c0c8]" />
        <form action={logout}>
          <button type="submit" className="text-[#9aa3aa] hover:text-white" title="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </form>
      </div>
    </header>
  );
}

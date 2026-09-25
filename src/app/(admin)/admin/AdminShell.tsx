'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { RoyalThemeToggle } from '@/components/theme/RoyalThemeToggle';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BadgePercent,
  BarChart3,
  Bot,
  CircleDollarSign,
  FileBarChart,
  Headphones,
  KeyRound,
  PackageOpen,
  ShieldAlert,
  Sparkles,
  Stethoscope,
  Users,
  WalletCards,
} from 'lucide-react';

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const navItems = [
    { name: 'Business Overview', href: '/admin', icon: BarChart3 },
    { name: 'Catalog', href: '/admin/catalog', icon: PackageOpen },
    { name: 'Users & Subscriptions', href: '/admin/users', icon: Users },
    { name: 'Access Management', href: '/admin/access', icon: KeyRound },
    { name: 'Support Performance', href: '/admin/support-performance', icon: Activity },
    { name: 'Trial Analytics', href: '/admin/trial-analytics', icon: Sparkles },
    { name: 'Product Analytics', href: '/admin/product-analytics', icon: BarChart3 },
    { name: 'Deep Dive AI', href: '/admin/deep-dive', icon: Bot },
    { name: 'Security & Risk', href: '/admin/security', icon: ShieldAlert },
    { name: 'Reports', href: '/admin/reports', icon: FileBarChart },
    { name: 'Alerts', href: '/admin/alerts', icon: AlertTriangle },
    { name: 'Revenue', href: '/admin/revenue', icon: CircleDollarSign },
    { name: 'Promo Codes', href: '/admin/promos', icon: BadgePercent },
    { name: 'Commissions', href: '/admin/commissions', icon: WalletCards },
    { name: 'Support Activation', href: '/support', icon: Headphones },
  ];

  return (
    <div className="royal-admin-shell min-h-screen flex bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-xs sm:text-sm">
      <aside className="w-60 bg-slate-900 text-slate-300 min-h-screen flex flex-col border-r border-slate-800 shrink-0">
        <div className="h-14 flex items-center gap-2.5 px-4 bg-slate-950 border-b border-slate-800">
          <div className="h-7 w-7 rounded-lg bg-purple-600 flex items-center justify-center text-white font-bold text-xs"><Stethoscope className="h-4 w-4" /></div>
          <span className="font-bold text-white text-sm">Admin Control</span>
          <RoyalThemeToggle className="ml-auto" />
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.href === '/admin' ? pathname === '/admin' : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return <Link key={item.href} href={item.href} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg font-medium transition-colors ${isActive ? 'bg-purple-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}><Icon className="h-4 w-4" /><span>{item.name}</span></Link>;
          })}
        </nav>
        <div className="p-3 border-t border-slate-800"><Link href="/dashboard" className="flex items-center gap-2 px-3 py-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"><ArrowLeft className="h-4 w-4" /><span>Exit to Student Portal</span></Link></div>
      </aside>
      <div className="flex-1 p-6 sm:p-8 overflow-y-auto">{children}</div>
    </div>
  );
}

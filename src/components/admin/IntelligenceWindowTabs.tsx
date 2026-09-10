import Link from 'next/link';

export function IntelligenceWindowTabs({
  baseHref,
  days,
}: {
  baseHref: string;
  days: number;
}) {
  return (
    <div className="inline-flex gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
      {[7, 30, 90].map((windowDays) => (
        <Link
          key={windowDays}
          href={`${baseHref}?days=${windowDays}`}
          className={`rounded-md px-3 py-1.5 text-[11px] font-semibold transition ${
            days === windowDays
              ? 'bg-purple-600 text-white'
              : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          {windowDays}d
        </Link>
      ))}
    </div>
  );
}

export function resolveIntelligenceWindow(raw: string | string[] | undefined) {
  const first = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number(first || 30);
  const days = [7, 30, 90].includes(parsed) ? parsed : 30;
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { days, from: from.toISOString(), to: to.toISOString() };
}

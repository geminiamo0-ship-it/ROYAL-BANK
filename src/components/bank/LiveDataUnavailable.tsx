import Link from 'next/link';

interface LiveDataUnavailableProps {
  bankId: string | number;
  title: string;
  description: string;
}

export function LiveDataUnavailable({ bankId, title, description }: LiveDataUnavailableProps) {
  return (
    <div className="mx-auto max-w-4xl py-10">
      <section className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Live data only</p>
        <h1 className="mt-2 text-xl font-bold text-slate-900 dark:text-white">{title}</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">{description}</p>
        <p className="mx-auto mt-2 max-w-xl text-xs text-slate-500">No sample records or placeholder metrics are shown.</p>
        <div className="mt-6 flex justify-center gap-2">
          <Link href={`/bank/${bankId}`} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Back to bank</Link>
          <Link href={`/bank/${bankId}/question-bank`} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700">Open question bank</Link>
        </div>
      </section>
    </div>
  );
}

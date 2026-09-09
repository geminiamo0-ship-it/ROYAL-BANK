export default function AdminSecurityPage() {
  return (
    <div className="mx-auto max-w-5xl pb-16">
      <section className="rounded-xl border border-slate-200 bg-white p-8 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Live data only</p>
        <h1 className="mt-2 text-xl font-bold text-slate-900 dark:text-white">Security & Risk</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
          Royal does not currently have a production IP-blocklist management table or admin RPC. The previous sample IPs and client-only block/unblock controls have been removed.
        </p>
        <p className="mt-3 text-xs text-slate-500">Security controls will appear here only after they are backed by auditable server-side storage and permissions.</p>
      </section>
    </div>
  );
}

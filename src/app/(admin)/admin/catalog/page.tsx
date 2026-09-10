import { getAdminCatalog } from '@/actions/catalog';
import { CatalogAdminClient } from '@/components/admin/CatalogAdminClient';

export default async function AdminCatalogPage() {
  const result = await getAdminCatalog();

  if (!result.ok) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6">
        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-red-500">Catalog unavailable</p>
        <h1 className="mt-2 text-2xl font-black">Unable to load Catalog & Plans</h1>
        <p className="mt-2 text-sm text-red-700 dark:text-red-300">{result.error}</p>
      </div>
    );
  }

  return <CatalogAdminClient initial={result.data} />;
}

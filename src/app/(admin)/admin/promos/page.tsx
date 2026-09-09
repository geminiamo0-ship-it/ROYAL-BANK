import { listAdminPromoCodes } from '@/actions/business-admin';
import { PromoAdminClient } from '@/components/business/PromoAdminClient';

export default async function AdminPromosPage() {
  const result = await listAdminPromoCodes();

  if (!result.ok) {
    return (
      <div className="mx-auto max-w-6xl rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
        {result.error}
      </div>
    );
  }

  return <PromoAdminClient initialPromos={result.data} />;
}

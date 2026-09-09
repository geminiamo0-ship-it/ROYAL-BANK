import { listAdminCommissions } from '@/actions/business-admin';
import { CommissionAdminClient } from '@/components/business/CommissionAdminClient';

export default async function AdminCommissionsPage() {
  const result = await listAdminCommissions({ limit: 200 });

  if (!result.ok) {
    return (
      <div className="mx-auto max-w-7xl rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
        {result.error}
      </div>
    );
  }

  return <CommissionAdminClient initialRows={result.data} />;
}

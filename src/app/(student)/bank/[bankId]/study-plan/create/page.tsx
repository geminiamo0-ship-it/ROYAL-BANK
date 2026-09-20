import { notFound, redirect } from 'next/navigation';
import { StudyPlanWizardClient } from '@/components/bank/StudyPlanWizardClient';
import {
  getStudyPlanPageData,
  StudyPlanAccessError,
  StudyPlanAuthenticationError,
  type StudyPlanCatalog,
  type StudyPlanDashboard,
} from '@/lib/study-plan';

export const preferredRegion = 'dub1';

export default async function StudyPlanCreatePage({
  params,
  searchParams,
}: {
  params: Promise<{ bankId: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const [{ bankId }, query] = await Promise.all([params, searchParams]);
  const parsedBankId = Number(bankId);
  if (!Number.isInteger(parsedBankId) || parsedBankId <= 0) notFound();

  let catalog: StudyPlanCatalog;
  let dashboard: StudyPlanDashboard;
  try {
    ({ catalog, dashboard } = await getStudyPlanPageData(parsedBankId));
  } catch (error) {
    if (error instanceof StudyPlanAuthenticationError) {
      redirect(`/login?redirect=/bank/${parsedBankId}/study-plan/create`);
    }
    if (error instanceof StudyPlanAccessError) {
      redirect('/dashboard?access=denied');
    }
    throw error;
  }

  if (catalog.topicCount === 0) {
    redirect(`/bank/${parsedBankId}/study-plan`);
  }

  const editing = query.edit === '1' ? dashboard.plan : null;
  if (!editing && dashboard.plan) {
    redirect(`/bank/${parsedBankId}/study-plan`);
  }

  return (
    <StudyPlanWizardClient
      bankId={parsedBankId}
      catalog={catalog}
      initialPlan={editing}
    />
  );
}

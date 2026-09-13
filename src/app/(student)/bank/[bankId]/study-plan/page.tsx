import { notFound, redirect } from 'next/navigation';
import { StudyPlanDashboardClient } from '@/components/bank/StudyPlanDashboardClient';
import {
  getStudyPlanDashboard,
  StudyPlanAccessError,
  StudyPlanAuthenticationError,
} from '@/lib/study-plan';

export const preferredRegion = 'dub1';

export default async function StudyPlanPage({
  params,
}: {
  params: Promise<{ bankId: string }>;
}) {
  const { bankId } = await params;
  const parsedBankId = Number(bankId);
  if (!Number.isInteger(parsedBankId) || parsedBankId <= 0) notFound();

  try {
    const dashboard = await getStudyPlanDashboard(parsedBankId);
    return <StudyPlanDashboardClient bankId={parsedBankId} initialDashboard={dashboard} />;
  } catch (error) {
    if (error instanceof StudyPlanAuthenticationError) {
      redirect(`/login?redirect=/bank/${parsedBankId}/study-plan`);
    }
    if (error instanceof StudyPlanAccessError) {
      redirect('/dashboard?access=denied');
    }
    throw error;
  }
}

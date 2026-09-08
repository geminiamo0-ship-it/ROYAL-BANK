import { notFound, redirect } from 'next/navigation';
import { HighYieldTextbookClient } from '@/components/bank/HighYieldTextbookClient';
import {
  getLibraryCatalog,
  LibraryAccessError,
  LibraryAuthenticationError,
  LibraryNotFoundError,
  type LibraryCatalog,
} from '@/lib/library';

interface HighYieldTextbookPageProps {
  params: Promise<{
    bankId: string;
  }>;
}

export default async function HighYieldTextbookPage({ params }: HighYieldTextbookPageProps) {
  const { bankId } = await params;
  const parsedBankId = Number(bankId);

  if (!Number.isInteger(parsedBankId) || parsedBankId <= 0) {
    notFound();
  }

  let catalog: LibraryCatalog;
  try {
    catalog = await getLibraryCatalog(parsedBankId);
  } catch (error) {
    if (error instanceof LibraryAuthenticationError) {
      redirect(`/login?redirect=/bank/${parsedBankId}/textbook/high-yield`);
    }

    if (error instanceof LibraryNotFoundError) {
      notFound();
    }

    if (error instanceof LibraryAccessError) {
      redirect('/dashboard?upgrade=true');
    }

    throw error;
  }

  return <HighYieldTextbookClient bankId={parsedBankId} initialCatalog={catalog} />;
}

import { NextRequest, NextResponse } from 'next/server';
import { getLiveQuestionBankCategories } from '@/lib/question-bank';

interface RouteContext {
  params: Promise<{
    bankId: string;
  }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { bankId } = await context.params;
  const parsedBankId = Number(bankId);

  if (!Number.isInteger(parsedBankId) || parsedBankId <= 0) {
    return NextResponse.json({ error: 'Invalid question bank.' }, { status: 400 });
  }

  try {
    const categories = await getLiveQuestionBankCategories(parsedBankId);

    return NextResponse.json({
      categories,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load question bank categories.';

    if (message === 'Authentication required') {
      return NextResponse.json({ error: message }, { status: 401 });
    }

    if (message === 'Question bank access required') {
      return NextResponse.json({ error: message }, { status: 403 });
    }

    return NextResponse.json({ error: 'Unable to load question bank categories.' }, { status: 500 });
  }
}

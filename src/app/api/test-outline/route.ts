import { NextResponse } from 'next/server';
import { getLiveQuestionBankOutline } from '@/lib/question-bank';

export async function GET() {
  const data = await getLiveQuestionBankOutline(1);
  return NextResponse.json(data);
}

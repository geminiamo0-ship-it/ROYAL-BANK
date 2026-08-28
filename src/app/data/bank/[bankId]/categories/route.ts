import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { CategorySummary } from '@/actions/exam';

interface RouteContext {
  params: Promise<{
    bankId: string;
  }>;
}

interface CountRow {
  id: number;
  category: string | null;
}

async function getAllQuestionRows() {
  const supabase = createAdminClient();
  const rows: CountRow[] = [];
  const pageSize = 1000;
  let start = 0;

  while (true) {
    const { data, error } = await supabase
      .from('questions')
      .select('id, category')
      .order('id', { ascending: true })
      .range(start, start + pageSize - 1);

    if (error) {
      throw error;
    }

    rows.push(...((data || []) as CountRow[]));

    if (!data || data.length < pageSize) {
      break;
    }

    start += pageSize;
  }

  return rows;
}

function buildCategorySummaries(rows: CountRow[]): CategorySummary[] {
  const counts = new Map<string, number>();

  for (const row of rows) {
    if (!row.category) continue;
    counts.set(row.category, (counts.get(row.category) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([category, total]) => ({
      id: category,
      name: category,
      total,
      attempted: 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function GET(_request: NextRequest, context: RouteContext) {
  await context.params;
  const rows = await getAllQuestionRows();
  const categories = buildCategorySummaries(rows);

  return NextResponse.json({
    categories,
    fetchedAt: new Date().toISOString(),
  });
}

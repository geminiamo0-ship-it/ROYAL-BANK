import { NextResponse } from 'next/server';
import { isPrivateR2Configured, readPrivateR2Json } from '@/lib/r2-private';

export const dynamic = 'force-dynamic';
export const preferredRegion = 'dub1';

async function probe(key: string, maxBytes: number) {
  try {
    const value = await readPrivateR2Json<Record<string, unknown>>(key, { maxBytes });
    return {
      ok: value != null,
      schemaVersion: Number(value?.schema_version ?? 0),
      bankId: Number(value?.bank_id ?? 0),
      itemCount: Array.isArray(value?.articles)
        ? value.articles.length
        : Array.isArray(value?.categories)
          ? value.categories.length
          : null,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'unknown_error',
    };
  }
}

export async function GET() {
  const [library, studyPlan] = await Promise.all([
    probe('ui-static-v1/library/catalogs/1.json', 1024 * 1024),
    probe('ui-static-v1/study-plan/catalogs/1.json', 1024 * 1024),
  ]);

  return NextResponse.json(
    {
      configured: isPrivateR2Configured(),
      library,
      studyPlan,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}

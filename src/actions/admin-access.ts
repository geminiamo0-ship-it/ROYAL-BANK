'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { AdminAccessLedgerRow } from '@/types/admin-operations';
import type { AdminOperationsResult } from '@/actions/admin-operations';

const accessListSchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    status: z.enum(['active', 'upcoming', 'expired', 'revoked']).nullable().optional(),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .strict();

export async function listAdminAccessGrants(
  input: unknown = {},
): Promise<AdminOperationsResult<AdminAccessLedgerRow[]>> {
  const parsed = accessListSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || 'Invalid access filter.' };
  }

  const value = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_list_access_grants', {
    p_search: value.search || null,
    p_status: value.status ?? null,
    p_limit: value.limit ?? 200,
    p_offset: value.offset ?? 0,
  });

  if (error) {
    const message = error.message || '';
    if (message.includes('ADMIN_ACCESS_REQUIRED')) return { ok: false, error: 'Admin access is required.' };
    if (message.includes('INVALID_ACCESS_SEARCH')) return { ok: false, error: 'Access search is too long.' };
    if (message.includes('INVALID_ACCESS_STATUS')) return { ok: false, error: 'Choose a valid access status.' };
    return { ok: false, error: 'Unable to load the access ledger.' };
  }

  return { ok: true, data: (data || []) as AdminAccessLedgerRow[] };
}

'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

export type DeepDiveSupportUser = {
  id: string;
  email: string;
  full_name: string | null;
};

export type DeepDiveSupportLookupResult =
  | { ok: true; data: DeepDiveSupportUser }
  | { ok: false; error: string };

const identifierSchema = z.string().trim().min(3).max(200);

async function requireSupportActor(): Promise<
  | { ok: true; actorId: string }
  | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, error: 'Please sign in again.' };

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role,is_active')
    .eq('id', user.id)
    .single();

  if (error || !profile?.is_active || !['admin', 'support'].includes(profile.role)) {
    return { ok: false, error: 'Support access is required.' };
  }

  return { ok: true, actorId: user.id };
}

export async function resolveDeepDiveSupportUser(
  identifier: string,
): Promise<DeepDiveSupportLookupResult> {
  const parsed = identifierSchema.safeParse(identifier);
  if (!parsed.success) {
    return { ok: false, error: 'Enter a valid account email or user ID.' };
  }

  const actor = await requireSupportActor();
  if (!actor.ok) return actor;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('support_resolve_deep_dive_user', {
    p_identifier: parsed.data,
  });

  if (error) return { ok: false, error: 'Unable to search Royal accounts.' };
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return { ok: false, error: 'No Royal account matched that email or user ID.' };

  return {
    ok: true,
    data: {
      id: String(row.id),
      email: String(row.email || ''),
      full_name: row.full_name == null ? null : String(row.full_name),
    },
  };
}

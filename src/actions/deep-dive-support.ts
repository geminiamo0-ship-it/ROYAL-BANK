'use server';

import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
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
const uuidSchema = z.string().uuid();

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

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: 'The secure support service is not configured.' };
  }

  const value = parsed.data;
  let query = admin
    .from('profiles')
    .select('id,email,full_name')
    .limit(1);

  query = uuidSchema.safeParse(value).success
    ? query.eq('id', value)
    : query.ilike('email', value);

  const { data, error } = await query.maybeSingle();
  if (error) return { ok: false, error: 'Unable to search Royal accounts.' };
  if (!data) return { ok: false, error: 'No Royal account matched that email or user ID.' };

  return {
    ok: true,
    data: {
      id: String(data.id),
      email: String(data.email || ''),
      full_name: data.full_name == null ? null : String(data.full_name),
    },
  };
}

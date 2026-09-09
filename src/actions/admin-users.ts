'use server';

import { randomInt } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export type AdminUserActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const userIdSchema = z.string().uuid();
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%*-_+';
const ALL = `${UPPER}${LOWER}${DIGITS}${SYMBOLS}`;

function pick(source: string) {
  return source[randomInt(source.length)];
}

function shuffleSecurely(characters: string[]) {
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  return characters.join('');
}

function generateTemporaryPassword(length = 18) {
  const characters = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  while (characters.length < length) characters.push(pick(ALL));
  return shuffleSecurely(characters);
}

async function requireAdminActor() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false as const, error: 'Please sign in again.' };

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role,is_active')
    .eq('id', user.id)
    .single();

  if (error || !profile?.is_active || profile.role !== 'admin') {
    return { ok: false as const, error: 'Admin access is required.' };
  }

  return { ok: true as const, user };
}

async function writePasswordAudit(input: {
  actorUserId: string;
  action: string;
  targetUserId: string;
  metadata?: Record<string, unknown>;
}) {
  const admin = createAdminClient();
  return admin.from('admin_audit_logs').insert({
    actor_user_id: input.actorUserId,
    actor_role: 'admin',
    action: input.action,
    entity_type: 'user',
    entity_id: input.targetUserId,
    metadata: input.metadata || {},
  });
}

export async function regenerateUserTemporaryPassword(
  userId: string,
): Promise<AdminUserActionResult<{ temporaryPassword: string }>> {
  const parsedUserId = userIdSchema.safeParse(userId);
  if (!parsedUserId.success) return { ok: false, error: 'Invalid user account.' };

  const actor = await requireAdminActor();
  if (!actor.ok) return actor;

  if (actor.user.id === parsedUserId.data) {
    return { ok: false, error: 'Use Change Password for your own administrator account.' };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: 'The secure password reset service is not configured.' };
  }

  const { data: target, error: targetError } = await admin.auth.admin.getUserById(parsedUserId.data);
  if (targetError || !target.user) {
    return { ok: false, error: 'The authentication account could not be found.' };
  }

  const requestedAudit = await writePasswordAudit({
    actorUserId: actor.user.id,
    action: 'user_temp_password_reset_requested',
    targetUserId: parsedUserId.data,
    metadata: { force_change_on_next_use: true },
  });
  if (requestedAudit.error) {
    return { ok: false, error: 'Password reset was blocked because the audit trail could not be recorded.' };
  }

  const temporaryPassword = generateTemporaryPassword();
  const issuedAt = new Date().toISOString();
  const appMetadata = target.user.app_metadata || {};
  const { error: updateError } = await admin.auth.admin.updateUserById(parsedUserId.data, {
    password: temporaryPassword,
    app_metadata: {
      ...appMetadata,
      must_change_password: true,
      temporary_password_issued_at: issuedAt,
    },
  });

  if (updateError) {
    await writePasswordAudit({
      actorUserId: actor.user.id,
      action: 'user_temp_password_reset_failed',
      targetUserId: parsedUserId.data,
      metadata: { reason: 'auth_update_failed' },
    });
    return { ok: false, error: 'Unable to update this user password.' };
  }

  await writePasswordAudit({
    actorUserId: actor.user.id,
    action: 'user_temp_password_reset_completed',
    targetUserId: parsedUserId.data,
    metadata: {
      force_change_on_next_use: true,
      issued_at: issuedAt,
    },
  });

  revalidatePath('/admin/users');
  return { ok: true, data: { temporaryPassword } };
}

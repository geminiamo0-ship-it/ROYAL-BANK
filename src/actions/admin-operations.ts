'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function setAdminUserActive(userId: string, isActive: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_update_user_access', {
    p_user_id: userId,
    p_is_active: isActive,
  });

  if (error) throw new Error(error.message);
  revalidatePath('/admin/users');
}

export async function addAdminIpBlock(formData: FormData) {
  const ipAddress = String(formData.get('ipAddress') || '').trim();
  const reason = String(formData.get('reason') || '').trim();
  if (!ipAddress || !reason) throw new Error('IP address and reason are required.');
  if (reason.length > 500) throw new Error('Reason is too long.');

  const supabase = await createClient();
  const { error } = await supabase.from('ip_blocklist').insert({
    ip_address: ipAddress,
    reason,
  });

  if (error) throw new Error(error.message);
  revalidatePath('/admin/security');
}

export async function removeAdminIpBlock(id: number) {
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid block ID.');
  const supabase = await createClient();
  const { error } = await supabase.from('ip_blocklist').delete().eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/admin/security');
}

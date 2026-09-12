import Link from 'next/link';
import { ArrowLeft, Clock3, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { getAdminUserDetail } from '@/actions/admin-operations';
import { UserOperationsClient } from '@/components/admin/UserOperationsClient';
import { UserPasswordResetAction } from '@/components/admin/UserPasswordResetAction';
import { createClient } from '@/lib/supabase/server';

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const supabase = await createClient();
  const [{ data: { user: actor } }, detailResult, pathwaysResult, banksResult] = await Promise.all([
    supabase.auth.getUser(),
    getAdminUserDetail(userId),
    supabase.from('pathways').select('id,name').order('display_order', { ascending: true }).order('id'),
    supabase.from('question_banks').select('id,pathway_id,name').order('display_order', { ascending: true }).order('id'),
  ]);

  if (!detailResult.ok) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Link href="/admin/users" className="inline-flex items-center gap-1.5 text-xs font-semibold text-purple-600 hover:text-purple-500">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to users
        </Link>
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {detailResult.error}
        </div>
      </div>
    );
  }

  const detail = detailResult.data;
  const profile = detail.profile;
  const pathways = (pathwaysResult.data || []) as Array<{ id: number; name: string }>;
  const banks = (banksResult.data || []) as Array<{ id: number; pathway_id: number; name: string }>;
  const catalogError = pathwaysResult.error || banksResult.error;

  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-16">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/admin/users" className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-purple-600 hover:text-purple-500">
            <ArrowLeft className="h-3.5 w-3.5" /> Users & subscriptions
          </Link>
          <h1 className="mt-2 text-xl font-bold text-slate-900 dark:text-white">{profile.full_name || 'Unnamed user'}</h1>
          <p className="mt-1 text-xs text-slate-500">Full account, role and entitlement operations.</p>
        </div>
        <UserPasswordResetAction
          userId={profile.id}
          email={profile.email}
          disabled={profile.id === actor?.id}
        />
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <InfoCard icon={Mail} label="Email" value={profile.email} />
        <InfoCard icon={ShieldCheck} label="Role / status" value={`${profile.role} · ${profile.is_active ? 'Active' : 'Suspended'}`} />
        <InfoCard icon={Clock3} label="Last login" value={formatDate(profile.last_login_at)} note={profile.last_login_ip ? `IP ${profile.last_login_ip}` : undefined} />
        <InfoCard icon={UserRound} label="Joined" value={formatDate(profile.created_at)} />
      </section>

      {catalogError ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          The access catalog could not be loaded. Account controls remain available, but new grants are temporarily unavailable.
        </div>
      ) : (
        <UserOperationsClient
          userId={profile.id}
          currentRole={profile.role}
          isActive={profile.is_active}
          isSelf={profile.id === actor?.id}
          grants={detail.grants}
          pathways={pathways}
          banks={banks}
        />
      )}

      {catalogError && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <h2 className="font-bold text-slate-900 dark:text-white">Recorded access history</h2>
          <p className="mt-2 text-xs text-slate-500">{detail.grants.length} grant records are attached to this account.</p>
        </section>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <h2 className="font-bold text-slate-900 dark:text-white">Recent admin audit</h2>
          <p className="mt-0.5 text-[10px] text-slate-500">Latest 50 user and access-ledger events for this account.</p>
        </div>
        {detail.audit.length === 0 ? (
          <div className="p-5 text-xs text-slate-500">No admin audit events recorded for this user yet.</div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {detail.audit.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-xs">
                <div>
                  <p className="font-semibold text-slate-800 dark:text-slate-100">{row.action.replaceAll('_', ' ')}</p>
                  <p className="mt-0.5 text-[10px] text-slate-400">{row.entity_type} · {row.actor_role || 'system'}</p>
                </div>
                <time className="text-[10px] text-slate-500">{formatDate(row.created_at)}</time>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function InfoCard({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 text-slate-400"><Icon className="h-4 w-4" /><span className="text-[10px] font-semibold uppercase tracking-wide">{label}</span></div>
      <p className="mt-2 break-words text-xs font-bold text-slate-900 dark:text-white">{value}</p>
      {note && <p className="mt-1 text-[10px] text-slate-400">{note}</p>}
    </div>
  );
}

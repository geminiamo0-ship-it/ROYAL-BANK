import type React from 'react';
import type { SupportUpgradeDetail, UpgradeRequestStatus } from '@/types/business';

export const inputClass =
  'h-11 w-full rounded-lg border border-slate-700 bg-[#07101e] px-3 text-sm font-medium text-slate-100 outline-none placeholder:text-slate-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500/30 disabled:cursor-not-allowed disabled:bg-[#0b1424] disabled:text-slate-500';

function visibleStatus(status: UpgradeRequestStatus) {
  return status === 'contacted' ? 'pending' : status;
}

export function RequestHeader({ detail }: { detail: SupportUpgradeDetail }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-5 border-b border-slate-800 pb-5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-mono text-sm font-black tracking-wide text-purple-400">{detail.request.public_code}</p>
          <StatusBadge status={detail.request.status} />
        </div>
        <h2 className="mt-2 truncate text-xl font-bold text-white">
          {detail.user.full_name || detail.user.email}
        </h2>
        <p className="mt-1 text-sm font-medium text-slate-300">{detail.user.email}</p>
      </div>
      <div className="text-left sm:text-right">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Requested product</p>
        <p className="mt-1 text-sm font-bold text-slate-100">{detail.request.product_name}</p>
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: UpgradeRequestStatus }) {
  const shown = visibleStatus(status);
  const classes: Record<ReturnType<typeof visibleStatus>, string> = {
    pending: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    paid: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
    activated: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    cancelled: 'border-red-500/30 bg-red-500/10 text-red-300',
  };

  return (
    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${classes[shown]}`}>
      {shown}
    </span>
  );
}

export function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-[#081120] px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-1.5 truncate text-sm font-bold capitalize text-slate-100">{value}</p>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1.5 block text-[11px] font-bold text-slate-300">{label}</span>
      {children}
    </label>
  );
}

export function MoneyField({
  label,
  value,
  setValue,
  disabled,
}: {
  label: string;
  value: string;
  setValue: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={disabled}
        className={inputClass}
      />
    </Field>
  );
}

export function formatMoney(
  value: number | string | null | undefined,
  currency: string | null | undefined
) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return `${value ?? 0} ${currency || ''}`.trim();
  return `${numeric.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ${currency || ''}`.trim();
}

export function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function formatPromoDiscount(promo: NonNullable<SupportUpgradeDetail['promo']>) {
  if (promo.discount_type === 'none') return 'tracking only';
  if (promo.discount_type === 'percentage') {
    return `${promo.discount_value}% customer discount`;
  }
  if (promo.discount_type === 'fixed') {
    return `${promo.discount_value} ${promo.discount_currency || ''} customer discount`.trim();
  }
  return `special price ${promo.discount_value} ${promo.discount_currency || ''}`.trim();
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-200">
      {message}
    </div>
  );
}

export function SuccessBox({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200">
      {message}
    </div>
  );
}

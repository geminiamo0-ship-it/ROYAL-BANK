import type React from 'react';
import type { SupportUpgradeDetail, UpgradeRequestStatus } from '@/types/business';

export const inputClass =
  'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-purple-500 disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:disabled:bg-slate-900';

export function RequestHeader({ detail }: { detail: SupportUpgradeDetail }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
      <div>
        <div className="flex items-center gap-2">
          <p className="font-mono text-sm font-bold text-purple-600">{detail.request.public_code}</p>
          <StatusBadge status={detail.request.status} />
        </div>
        <h2 className="mt-2 text-xl font-bold text-slate-900 dark:text-white">
          {detail.user.full_name || 'Royal user'}
        </h2>
        <p className="text-sm text-slate-500">{detail.user.email}</p>
      </div>
      <div className="text-right">
        <p className="text-xs uppercase text-slate-400">Requested</p>
        <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-200">
          {detail.request.product_name}
        </p>
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: UpgradeRequestStatus }) {
  const classes: Record<UpgradeRequestStatus, string> = {
    pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    contacted: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
    paid: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
    activated: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    cancelled: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  };

  return (
    <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${classes[status]}`}>
      {status}
    </span>
  );
}

export function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-3 dark:bg-slate-950">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold capitalize text-slate-800 dark:text-slate-200">
        {value}
      </p>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1.5 block text-[11px] font-semibold text-slate-500">{label}</span>
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
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
      {message}
    </div>
  );
}

export function SuccessBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
      {message}
    </div>
  );
}

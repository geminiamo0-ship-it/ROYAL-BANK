'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BadgePercent, Pencil, Save, Tag } from 'lucide-react';
import { saveAdminPromoCode } from '@/actions/business-admin';
import type { AdminPromoCodeRow } from '@/types/business-admin';

interface PromoAdminClientProps {
  initialPromos: AdminPromoCodeRow[];
}

type DiscountType = AdminPromoCodeRow['discount_type'];
type CommissionType = AdminPromoCodeRow['commission_type'];

interface PromoFormState {
  promoId: number | null;
  code: string;
  ownerEmail: string;
  status: 'active' | 'inactive';
  discountType: DiscountType;
  discountValue: string;
  discountCurrency: string;
  commissionType: CommissionType;
  commissionValue: string;
  commissionCurrency: string;
  commissionBasis: 'amount_paid' | 'agreed_price';
  validFrom: string;
  validUntil: string;
  maxActivations: string;
}

const emptyForm: PromoFormState = {
  promoId: null,
  code: '',
  ownerEmail: '',
  status: 'active',
  discountType: 'none',
  discountValue: '',
  discountCurrency: 'EGP',
  commissionType: 'none',
  commissionValue: '',
  commissionCurrency: 'EGP',
  commissionBasis: 'amount_paid',
  validFrom: '',
  validUntil: '',
  maxActivations: '',
};

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-purple-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white';

function toLocalInput(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIso(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatRule(type: DiscountType | CommissionType, value: number | string | null, currency: string | null) {
  if (type === 'none') return 'None';
  if (type === 'percentage') return `${value ?? 0}%`;
  if (type === 'special_price') return `Special ${value ?? 0} ${currency || ''}`.trim();
  return `${value ?? 0} ${currency || ''}`.trim();
}

export function PromoAdminClient({ initialPromos }: PromoAdminClientProps) {
  const router = useRouter();
  const [form, setForm] = useState<PromoFormState>(emptyForm);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isPending, startTransition] = useTransition();

  const title = form.promoId ? `Edit ${form.code}` : 'Create promo code';
  const sortedPromos = useMemo(() => initialPromos, [initialPromos]);

  function update<K extends keyof PromoFormState>(key: K, value: PromoFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function editPromo(promo: AdminPromoCodeRow) {
    setError('');
    setSuccess('');
    setForm({
      promoId: promo.id,
      code: promo.code,
      ownerEmail: promo.owner_email || '',
      status: promo.status,
      discountType: promo.discount_type,
      discountValue: promo.discount_value == null ? '' : String(promo.discount_value),
      discountCurrency: promo.discount_currency || 'EGP',
      commissionType: promo.commission_type,
      commissionValue: promo.commission_value == null ? '' : String(promo.commission_value),
      commissionCurrency: promo.commission_currency || 'EGP',
      commissionBasis: promo.commission_basis,
      validFrom: toLocalInput(promo.valid_from),
      validUntil: toLocalInput(promo.valid_until),
      maxActivations: promo.max_activations == null ? '' : String(promo.max_activations),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetForm() {
    setForm(emptyForm);
    setError('');
    setSuccess('');
  }

  function submit() {
    setError('');
    setSuccess('');

    const discountValue = form.discountType === 'none' ? null : Number(form.discountValue);
    const commissionValue = form.commissionType === 'none' ? null : Number(form.commissionValue);
    const maxActivations = form.maxActivations ? Number(form.maxActivations) : null;

    if (discountValue !== null && !Number.isFinite(discountValue)) {
      setError('Enter a valid customer discount value.');
      return;
    }
    if (commissionValue !== null && !Number.isFinite(commissionValue)) {
      setError('Enter a valid commission value.');
      return;
    }
    if (maxActivations !== null && (!Number.isInteger(maxActivations) || maxActivations <= 0)) {
      setError('Activation limit must be a positive whole number.');
      return;
    }

    startTransition(async () => {
      const result = await saveAdminPromoCode({
        promoId: form.promoId,
        code: form.code,
        ownerEmail: form.ownerEmail.trim() || null,
        status: form.status,
        discountType: form.discountType,
        discountValue,
        discountCurrency:
          form.discountType === 'fixed' || form.discountType === 'special_price'
            ? form.discountCurrency.trim().toUpperCase()
            : null,
        commissionType: form.commissionType,
        commissionValue,
        commissionCurrency:
          form.commissionType === 'fixed' ? form.commissionCurrency.trim().toUpperCase() : null,
        commissionBasis: form.commissionBasis,
        validFrom: toIso(form.validFrom),
        validUntil: toIso(form.validUntil),
        maxActivations,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setSuccess(`${result.data.code} saved.`);
      setForm(emptyForm);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-16 text-xs sm:text-sm">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Promo Codes</h1>
        <p className="text-xs text-slate-500">
          Manage customer discounts, coupon ownership, and internal commission rules. Historical sales keep their original rule snapshot.
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-purple-600" />
            <h2 className="font-bold text-slate-900 dark:text-white">{title}</h2>
          </div>
          {form.promoId && (
            <button type="button" onClick={resetForm} className="text-xs font-semibold text-slate-500 hover:text-slate-900 dark:hover:text-white">
              Cancel edit
            </button>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Field label="Code">
            <input className={inputClass} value={form.code} onChange={(event) => update('code', event.target.value.toUpperCase())} placeholder="DRMOHAMED" />
          </Field>
          <Field label="Coupon owner email">
            <input className={inputClass} value={form.ownerEmail} onChange={(event) => update('ownerEmail', event.target.value)} placeholder="doctor@example.com" />
          </Field>
          <Field label="Status">
            <select className={inputClass} value={form.status} onChange={(event) => update('status', event.target.value as 'active' | 'inactive')}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </Field>
          <Field label="Max successful activations">
            <input className={inputClass} type="number" min="1" value={form.maxActivations} onChange={(event) => update('maxActivations', event.target.value)} placeholder="Unlimited" />
          </Field>

          <Field label="Customer discount">
            <select className={inputClass} value={form.discountType} onChange={(event) => update('discountType', event.target.value as DiscountType)}>
              <option value="none">Tracking only</option>
              <option value="percentage">Percentage</option>
              <option value="fixed">Fixed amount</option>
              <option value="special_price">Special price</option>
            </select>
          </Field>
          <Field label="Discount value">
            <input className={inputClass} type="number" min="0" step="0.01" disabled={form.discountType === 'none'} value={form.discountValue} onChange={(event) => update('discountValue', event.target.value)} />
          </Field>
          <Field label="Discount currency">
            <input className={inputClass} maxLength={3} disabled={form.discountType !== 'fixed' && form.discountType !== 'special_price'} value={form.discountCurrency} onChange={(event) => update('discountCurrency', event.target.value.toUpperCase())} />
          </Field>
          <Field label="Commission basis">
            <select className={inputClass} value={form.commissionBasis} onChange={(event) => update('commissionBasis', event.target.value as 'amount_paid' | 'agreed_price')}>
              <option value="amount_paid">Amount actually paid</option>
              <option value="agreed_price">Agreed price</option>
            </select>
          </Field>

          <Field label="Partner commission">
            <select className={inputClass} value={form.commissionType} onChange={(event) => update('commissionType', event.target.value as CommissionType)}>
              <option value="none">No commission</option>
              <option value="percentage">Percentage</option>
              <option value="fixed">Fixed amount</option>
            </select>
          </Field>
          <Field label="Commission value">
            <input className={inputClass} type="number" min="0" step="0.01" disabled={form.commissionType === 'none'} value={form.commissionValue} onChange={(event) => update('commissionValue', event.target.value)} />
          </Field>
          <Field label="Commission currency">
            <input className={inputClass} maxLength={3} disabled={form.commissionType !== 'fixed'} value={form.commissionCurrency} onChange={(event) => update('commissionCurrency', event.target.value.toUpperCase())} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Starts">
              <input className={inputClass} type="datetime-local" value={form.validFrom} onChange={(event) => update('validFrom', event.target.value)} />
            </Field>
            <Field label="Ends">
              <input className={inputClass} type="datetime-local" value={form.validUntil} onChange={(event) => update('validUntil', event.target.value)} />
            </Field>
          </div>
        </div>

        {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div>}
        {success && <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">{success}</div>}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={submit}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-xs font-bold text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {isPending ? 'Saving…' : 'Save promo'}
          </button>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <BadgePercent className="h-4 w-4 text-purple-600" />
          <h2 className="font-bold text-slate-900 dark:text-white">Promo registry</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 dark:bg-slate-800/60">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Discount</th>
                <th className="px-4 py-3">Commission</th>
                <th className="px-4 py-3">Activated users</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {sortedPromos.map((promo) => (
                <tr key={promo.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                  <td className="px-4 py-3 font-mono font-bold text-slate-900 dark:text-white">{promo.code}</td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-800 dark:text-slate-200">{promo.owner_name || 'Unassigned'}</p>
                    <p className="text-[11px] text-slate-500">{promo.owner_email || '—'}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatRule(promo.discount_type, promo.discount_value, promo.discount_currency)}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatRule(promo.commission_type, promo.commission_value, promo.commission_currency)}</td>
                  <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">{Number(promo.activated_users).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${promo.status === 'active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                      {promo.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => editPromo(promo)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-purple-700 hover:bg-purple-50 dark:text-purple-300 dark:hover:bg-purple-950/40">
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                  </td>
                </tr>
              ))}
              {sortedPromos.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">No promo codes yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5">
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

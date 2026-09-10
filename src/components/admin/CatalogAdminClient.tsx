'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  saveAdminCatalogPlan,
  saveAdminCatalogProduct,
  updateAdminCatalogBankTrial,
} from '@/actions/catalog';
import type { AdminCatalogPayload, AdminCatalogPlan, AdminCatalogProduct } from '@/types/catalog';

const inputClass = 'h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:border-purple-500 disabled:cursor-not-allowed disabled:opacity-50';
const smallInputClass = 'h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-white outline-none focus:border-purple-500 disabled:opacity-50';

function readNumber(form: FormData, name: string): number {
  return Number(form.get(name) || 0);
}

function readNullableNumber(form: FormData, name: string): number | null {
  const value = String(form.get(name) || '').trim();
  return value === '' ? null : Number(value);
}

function durationLabel(months: number | null) {
  return months === null ? 'Lifetime' : `${months} month${months === 1 ? '' : 's'}`;
}

function ProductSettings({ product, run }: { product: AdminCatalogProduct; run: (task: () => Promise<void>) => void }) {
  const archived = product.status === 'archived';
  return (
    <form
      className="grid gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4 md:grid-cols-2 xl:grid-cols-5"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        run(async () => {
          const result = await saveAdminCatalogProduct({
            productId: product.id,
            status: String(form.get('status')),
            displayOrder: readNumber(form, 'displayOrder'),
            showPrices: form.get('showPrices') === 'on',
            scopeDescription: String(form.get('scopeDescription') || ''),
          });
          if (!result.ok) throw new Error(result.error);
        });
      }}
    >
      <label className="text-xs font-bold text-slate-300">Status
        <select name="status" defaultValue={product.status} disabled={archived} className={`mt-1 ${inputClass}`}>
          <option value="draft">Draft</option><option value="active">Active</option><option value="hidden">Hidden</option><option value="archived">Archived</option>
        </select>
      </label>
      <label className="text-xs font-bold text-slate-300">Display order
        <input name="displayOrder" type="number" min="0" defaultValue={product.display_order} disabled={archived} className={`mt-1 ${inputClass}`} />
      </label>
      <label className="flex items-end gap-2 pb-2 text-xs font-bold text-slate-300">
        <input name="showPrices" type="checkbox" defaultChecked={product.show_prices} disabled={archived} className="h-4 w-4" /> Show published prices
      </label>
      <label className="text-xs font-bold text-slate-300 md:col-span-2">Scope description
        <input name="scopeDescription" defaultValue={product.scope_description} disabled={archived} maxLength={300} className={`mt-1 ${inputClass}`} />
      </label>
      {!archived && <button type="submit" className="h-10 rounded-lg bg-purple-600 px-4 text-xs font-black text-white hover:bg-purple-500 xl:col-start-5">Save product</button>}
    </form>
  );
}

function TrialSettings({ product, run }: { product: AdminCatalogProduct; run: (task: () => Promise<void>) => void }) {
  if (!product.trial || product.question_bank_id === null) return null;
  return (
    <form
      className="grid gap-3 rounded-xl border border-cyan-900/60 bg-cyan-950/20 p-4 sm:grid-cols-2 xl:grid-cols-5"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        run(async () => {
          const result = await updateAdminCatalogBankTrial({
            bankId: product.question_bank_id,
            isFreeTrial: form.get('isFreeTrial') === 'on',
            blockLimit: readNumber(form, 'blockLimit'),
            questionLimit: readNumber(form, 'questionLimit'),
            articleLimit: readNumber(form, 'articleLimit'),
          });
          if (!result.ok) throw new Error(result.error);
        });
      }}
    >
      <label className="flex items-end gap-2 pb-2 text-xs font-bold text-cyan-100"><input name="isFreeTrial" type="checkbox" defaultChecked={product.trial.is_free_trial} className="h-4 w-4" /> Free trial enabled</label>
      <label className="text-xs font-bold text-cyan-100">Block limit<input name="blockLimit" type="number" min="0" defaultValue={product.trial.free_trial_block_limit} className={`mt-1 ${inputClass}`} /></label>
      <label className="text-xs font-bold text-cyan-100">Question limit<input name="questionLimit" type="number" min="0" defaultValue={product.trial.free_trial_question_limit} className={`mt-1 ${inputClass}`} /></label>
      <label className="text-xs font-bold text-cyan-100">Article limit<input name="articleLimit" type="number" min="0" defaultValue={product.trial.free_trial_article_limit} className={`mt-1 ${inputClass}`} /></label>
      <button type="submit" className="h-10 self-end rounded-lg bg-cyan-700 px-4 text-xs font-black text-white hover:bg-cyan-600">Save trial</button>
    </form>
  );
}

function PlanForm({ product, plan, run }: { product: AdminCatalogProduct; plan: AdminCatalogPlan; run: (task: () => Promise<void>) => void }) {
  const archived = plan.status === 'archived' || product.status === 'archived';
  return (
    <form
      className="grid gap-2 rounded-lg border border-slate-800 bg-slate-950/50 p-3 md:grid-cols-4 xl:grid-cols-10"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        run(async () => {
          const result = await saveAdminCatalogPlan({
            planId: plan.id,
            productId: product.id,
            name: String(form.get('name') || ''),
            durationMonths: readNullableNumber(form, 'durationMonths'),
            price: readNullableNumber(form, 'price'),
            currency: String(form.get('currency') || '').toUpperCase(),
            status: String(form.get('status')),
            showPrice: form.get('showPrice') === 'on',
            isDefault: form.get('isDefault') === 'on',
            isRecommended: form.get('isRecommended') === 'on',
            displayOrder: readNumber(form, 'displayOrder'),
          });
          if (!result.ok) throw new Error(result.error);
        });
      }}
    >
      <input name="name" aria-label="Plan name" defaultValue={plan.name} disabled={archived} className={`md:col-span-2 ${smallInputClass}`} />
      <input name="durationMonths" aria-label="Duration months" type="number" min="1" max="120" placeholder="Lifetime" defaultValue={plan.duration_months ?? ''} disabled={archived} className={smallInputClass} />
      <input name="price" aria-label="Price" type="number" min="0.01" step="0.01" placeholder="Support sets price" defaultValue={plan.price ?? ''} disabled={archived} className={smallInputClass} />
      <input name="currency" aria-label="Currency" maxLength={3} defaultValue={plan.currency} disabled={archived} className={smallInputClass} />
      <select name="status" aria-label="Plan status" defaultValue={plan.status} disabled={archived} className={smallInputClass}><option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select>
      <input name="displayOrder" aria-label="Display order" type="number" min="0" defaultValue={plan.display_order} disabled={archived} className={smallInputClass} />
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-300 xl:col-span-2">
        <label><input name="showPrice" type="checkbox" defaultChecked={plan.show_price} disabled={archived} /> Price</label>
        <label><input name="isDefault" type="checkbox" defaultChecked={plan.is_default} disabled={archived} /> Default</label>
        <label><input name="isRecommended" type="checkbox" defaultChecked={plan.is_recommended} disabled={archived} /> Recommended</label>
      </div>
      {!archived && <button type="submit" className="rounded-md bg-slate-700 px-3 py-2 text-xs font-black text-white hover:bg-slate-600">Save</button>}
      <p className="md:col-span-4 xl:col-span-10 text-[10px] text-slate-500">{durationLabel(plan.duration_months)} · v{plan.version}{plan.price === null ? ' · price is intentionally manual' : ''}</p>
    </form>
  );
}

function NewPlanForm({ product, run }: { product: AdminCatalogProduct; run: (task: () => Promise<void>) => void }) {
  if (product.status === 'archived') return null;
  return (
    <form
      className="grid gap-2 rounded-lg border border-dashed border-slate-700 bg-slate-900/30 p-3 md:grid-cols-4 xl:grid-cols-10"
      onSubmit={(event) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        run(async () => {
          const result = await saveAdminCatalogPlan({
            planId: null,
            productId: product.id,
            name: String(form.get('name') || ''),
            durationMonths: readNullableNumber(form, 'durationMonths'),
            price: readNullableNumber(form, 'price'),
            currency: String(form.get('currency') || '').toUpperCase(),
            status: String(form.get('status')),
            showPrice: form.get('showPrice') === 'on',
            isDefault: form.get('isDefault') === 'on',
            isRecommended: form.get('isRecommended') === 'on',
            displayOrder: readNumber(form, 'displayOrder'),
          });
          if (!result.ok) throw new Error(result.error);
          formElement.reset();
        });
      }}
    >
      <input name="name" required placeholder="New plan name" className={`md:col-span-2 ${smallInputClass}`} />
      <input name="durationMonths" type="number" min="1" max="120" placeholder="Lifetime" className={smallInputClass} />
      <input name="price" type="number" min="0.01" step="0.01" placeholder="Optional price" className={smallInputClass} />
      <input name="currency" maxLength={3} defaultValue="EGP" required className={smallInputClass} />
      <select name="status" defaultValue="active" className={smallInputClass}><option value="active">Active</option><option value="inactive">Inactive</option></select>
      <input name="displayOrder" type="number" min="0" defaultValue="100" className={smallInputClass} />
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-300 xl:col-span-2">
        <label><input name="showPrice" type="checkbox" /> Price</label><label><input name="isDefault" type="checkbox" /> Default</label><label><input name="isRecommended" type="checkbox" /> Recommended</label>
      </div>
      <button type="submit" className="rounded-md border border-purple-500 px-3 py-2 text-xs font-black text-purple-200 hover:bg-purple-500/10">Add plan</button>
    </form>
  );
}

export function CatalogAdminClient({ initial }: { initial: AdminCatalogPayload }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(task: () => Promise<void>) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        await task();
        setMessage('Saved.');
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Unable to save catalog changes.');
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-[11px] font-black uppercase tracking-[0.22em] text-purple-500">Release E</p><h1 className="mt-1 text-3xl font-black">Catalog & Plans</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Products, durations, optional published pricing, trials, and audit history. Payment verification and activation stay manual.</p></div>
        {isPending && <span className="text-xs font-bold text-purple-500">Saving…</span>}
      </div>

      {message && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-700 dark:text-emerald-300">{message}</div>}
      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-700 dark:text-red-300">{error}</div>}

      <div className="space-y-5">
        {initial.products.map((product) => (
          <section key={product.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-purple-500">{product.product_type} product #{product.id}</p><h2 className="mt-1 text-xl font-black">{product.name}</h2><p className="mt-1 text-xs text-slate-500">{product.plans.length} plans · {product.show_prices ? 'published prices enabled' : 'prices hidden / Support confirms manually'}</p></div>
              <span className="rounded-full border border-slate-300 px-3 py-1 text-[10px] font-black uppercase dark:border-slate-700">{product.status}</span>
            </div>

            <div className="space-y-4">
              <ProductSettings product={product} run={run} />
              <TrialSettings product={product} run={run} />
              <div className="space-y-2">
                <div className="flex items-center justify-between"><h3 className="text-sm font-black">Plans</h3><span className="text-[10px] text-slate-500">Blank price = Support pricing; blank duration = Lifetime</span></div>
                {product.plans.map((plan) => <PlanForm key={plan.id} product={product} plan={plan} run={run} />)}
                <NewPlanForm product={product} run={run} />
              </div>
            </div>
          </section>
        ))}
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-black">Catalog audit trail</h2>
        <p className="mt-1 text-xs text-slate-500">Last {initial.audit.length} catalog changes.</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="border-b border-slate-200 text-[10px] uppercase text-slate-500 dark:border-slate-800"><tr><th className="py-2 pr-3">When</th><th className="py-2 pr-3">Action</th><th className="py-2 pr-3">Entity</th><th className="py-2 pr-3">Actor</th><th className="py-2">Change</th></tr></thead>
            <tbody>
              {initial.audit.map((entry) => (
                <tr key={entry.id} className="border-b border-slate-100 align-top dark:border-slate-800/70">
                  <td className="py-3 pr-3 whitespace-nowrap">{new Date(entry.created_at).toLocaleString()}</td>
                  <td className="py-3 pr-3 font-bold">{entry.action}</td>
                  <td className="py-3 pr-3">{entry.entity_type} #{entry.entity_id}</td>
                  <td className="py-3 pr-3 font-mono text-[10px]">{entry.actor_user_id || 'system'}</td>
                  <td className="py-3 text-[10px] text-slate-500">{entry.before_data ? 'before → after' : 'created / updated'}</td>
                </tr>
              ))}
              {initial.audit.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-slate-500">No catalog changes recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

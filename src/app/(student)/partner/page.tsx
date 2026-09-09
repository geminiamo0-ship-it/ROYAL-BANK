import { TicketCheck } from 'lucide-react';
import { getMyCouponSummary } from '@/actions/business-admin';

export default async function PartnerCouponPage() {
  const result = await getMyCouponSummary();

  if (!result.ok) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-red-900/50 bg-red-950/20 p-5 text-sm text-red-200">
        {result.error}
      </div>
    );
  }

  if (result.data.length === 0) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-[#424242] bg-[#303030] p-6 text-center text-white">
        <TicketCheck className="mx-auto mb-3 h-7 w-7 text-[#9aa3aa]" />
        <h1 className="text-lg font-bold">Royal Coupon</h1>
        <p className="mt-2 text-sm text-[#b7c0c8]">There is no coupon assigned to this account.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="text-xl font-bold text-white">Your Royal Coupon</h1>
        <p className="mt-1 text-xs text-[#9aa3aa]">
          The counter includes only customers whose payment and Royal access activation were completed successfully.
        </p>
      </div>

      {result.data.map((coupon) => (
        <section key={coupon.code} className="rounded-2xl border border-[#424242] bg-[#303030] p-6 text-white shadow-lg">
          <div className="flex items-center gap-2 text-[#b7c0c8]">
            <TicketCheck className="h-4 w-4" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">Coupon</span>
          </div>
          <p className="mt-3 break-all font-mono text-2xl font-black tracking-wider">{coupon.code}</p>

          <div className="mt-6 border-t border-[#424242] pt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#9aa3aa]">Successful activations</p>
            <p className="mt-1 text-4xl font-black">{Number(coupon.activated_users).toLocaleString()}</p>
          </div>
        </section>
      ))}
    </div>
  );
}

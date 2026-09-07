import { logout } from '@/actions/auth';

export default function InactiveAccountPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f4f4] px-4 text-[#111827]">
      <section className="w-full max-w-md border border-[#d7d7d7] bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Account disabled</h1>
        <p className="mt-3 text-sm leading-6 text-[#444]">
          This account is currently inactive. Access to RoyalBank resources is disabled until the account is reactivated.
        </p>
        <form action={logout} className="mt-6">
          <button
            type="submit"
            className="border border-[#0076a8] px-4 py-2 text-sm font-semibold text-[#0076a8] hover:bg-[#eef8fb]"
          >
            Sign out
          </button>
        </form>
      </section>
    </main>
  );
}

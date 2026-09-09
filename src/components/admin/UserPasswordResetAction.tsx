'use client';

import { useState, useTransition } from 'react';
import { Check, Clipboard, KeyRound, Loader2 } from 'lucide-react';
import { regenerateUserTemporaryPassword } from '@/actions/admin-users';

export function UserPasswordResetAction({
  userId,
  email,
  disabled = false,
}: {
  userId: string;
  email: string;
  disabled?: boolean;
}) {
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function regenerate() {
    if (disabled || pending) return;
    const confirmed = window.confirm(
      `Generate a new temporary password for ${email}? The previous password will stop working.`,
    );
    if (!confirmed) return;

    setError(null);
    setTemporaryPassword(null);
    setCopied(false);

    startTransition(async () => {
      const result = await regenerateUserTemporaryPassword(userId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTemporaryPassword(result.data.temporaryPassword);
    });
  }

  async function copyPassword() {
    if (!temporaryPassword) return;
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setCopied(true);
    } catch {
      setError('Could not copy automatically. Select the temporary password and copy it manually.');
    }
  }

  return (
    <div className="min-w-[230px]">
      <button
        type="button"
        onClick={regenerate}
        disabled={disabled || pending}
        className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/70"
        title={disabled ? 'Use Change Password for your own administrator account.' : 'Replace the current password with a temporary password'}
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
        {pending ? 'Generating…' : 'Regenerate password'}
      </button>

      {temporaryPassword ? (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 dark:border-amber-900 dark:bg-amber-950/30">
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 select-all break-all text-[11px] font-bold text-slate-900 dark:text-white">
              {temporaryPassword}
            </code>
            <button
              type="button"
              onClick={copyPassword}
              className="inline-flex shrink-0 items-center gap-1 rounded border border-amber-300 px-1.5 py-1 text-[10px] font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-300"
            >
              {copied ? <Check className="h-3 w-3" /> : <Clipboard className="h-3 w-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="mt-1.5 text-[10px] leading-4 text-amber-800/80 dark:text-amber-300/80">
            Copy this now. It is not stored in Royal audit logs. The user must choose a new password after signing in.
          </p>
        </div>
      ) : null}

      {error ? <p className="mt-1.5 max-w-[230px] text-[10px] leading-4 text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}

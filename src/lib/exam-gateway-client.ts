import { createClient } from '@/lib/supabase/client';

export type ExamGatewayAction =
  | 'create'
  | 'bootstrap'
  | 'window'
  | 'submit'
  | 'submitRaw'
  | 'feedback'
  | 'flag'
  | 'complete';

export const isExamGatewayEnabled =
  process.env.NEXT_PUBLIC_EXAM_GATEWAY_ENABLED === 'true';

function extractGatewayError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;

  const record = payload as Record<string, unknown>;
  if (typeof record.message === 'string' && record.message) return record.message;

  if (record.error && typeof record.error === 'object') {
    const error = record.error as Record<string, unknown>;
    if (typeof error.message === 'string' && error.message) return error.message;
    if (typeof error.code === 'string' && error.code) return error.code;
  }

  if (typeof record.code === 'string' && record.code) return record.code;
  return fallback;
}

export async function callExamGateway<T>(
  action: ExamGatewayAction,
  args: Record<string, unknown>
): Promise<T> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  if (error || !accessToken) {
    throw new Error('Authentication required.');
  }

  const response = await fetch('/api/exam', {
    method: 'POST',
    cache: 'no-store',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ action, args }),
  });

  const rawBody = await response.text();
  let payload: unknown = null;

  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    throw new Error(
      extractGatewayError(payload, `Exam request failed (${response.status}).`)
    );
  }

  return payload as T;
}

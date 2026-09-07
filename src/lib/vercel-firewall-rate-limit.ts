// Minimal server-only client for Vercel's programmatic Firewall rate-limit endpoint.
// This intentionally mirrors the request contract used by @vercel/firewall while
// keeping the application lockfile unchanged. Keep this helper isolated so it can
// be replaced with the official package without touching exam security semantics.

type RateLimitResult = {
  rateLimited: boolean;
  error?: 'not-found' | 'blocked';
};

function parseCookies(headers: Headers): Record<string, string> {
  const raw = headers.get('cookie');
  if (!raw) return {};

  return raw.split(';').reduce<Record<string, string>>((cookies, part) => {
    const cookie = part.trim();
    const separator = cookie.indexOf('=');
    if (separator === -1) {
      cookies[cookie] = '';
    } else {
      cookies[cookie.slice(0, separator)] = cookie.slice(separator + 1);
    }
    return cookies;
  }, {});
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

export async function checkVercelRateLimit(
  rateLimitId: string,
  options: {
    request: Request;
    rateLimitKey: string;
  }
): Promise<RateLimitResult> {
  // The production rollout flag is never enabled for local development. Returning
  // pass-through here also keeps tests/builds independent from Vercel infrastructure.
  if (process.env.NODE_ENV !== 'production') {
    return { rateLimited: false };
  }

  const requestHeaders = options.request.headers;
  const host = requestHeaders.get('host');
  if (!host) throw new Error('Vercel rate limit host is unavailable');

  let pathPrefix =
    process.env.PUBLIC_VERCEL_FIREWALL_PATH_PREFIX ||
    process.env.NEXT_PUBLIC_VERCEL_FIREWALL_PATH_PREFIX ||
    '';
  if (pathPrefix && !pathPrefix.startsWith('/')) pathPrefix = `/${pathPrefix}`;

  const keyHash = await sha256Hex(
    options.rateLimitKey +
      rateLimitId +
      (process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '') +
      (process.env.RATE_LIMIT_SECRET || '')
  );
  const fullRateLimitKey = `${options.rateLimitKey}-${keyHash}`;

  const headers = new Headers({
    'x-vercel-rate-limit-api': rateLimitId,
    'x-vercel-rate-limit-key': fullRateLimitKey,
    'user-agent': 'Bot/Vercel Rate Limit Checker',
    'x-forwarded-for': requestHeaders.get('x-forwarded-for') || '',
    'x-real-ip': requestHeaders.get('x-real-ip') || '',
    'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '',
  });

  const cookies = parseCookies(requestHeaders);
  if (cookies._vercel_jwt) {
    headers.append('cookie', `_vercel_jwt=${cookies._vercel_jwt}`);
  }

  for (const [key, value] of requestHeaders.entries()) {
    headers.append(`x-rr-${key}`, value);
  }

  const response = await fetch(
    `https://${host}${pathPrefix}/.well-known/vercel/rate-limit-api/${encodeURIComponent(rateLimitId)}`,
    {
      method: 'GET',
      headers,
      redirect: 'manual',
      cache: 'no-store',
    }
  );

  if (response.status === 204) return { rateLimited: false };
  if (response.status === 429) return { rateLimited: true };
  if (response.status === 403) return { rateLimited: true, error: 'blocked' };
  if (response.status === 404) return { rateLimited: false, error: 'not-found' };

  throw new Error(`Unexpected Vercel rate-limit response: ${response.status}`);
}

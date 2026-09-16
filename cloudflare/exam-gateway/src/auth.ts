import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

const remoteJwksByUrl = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export type VerifiedUser = {
  userId: string;
  claims: JWTPayload;
};

function normalizedProjectRef(env: Env): string {
  const value = env.SUPABASE_PROJECT_REF.trim().toLowerCase();
  if (!/^[a-z0-9]{20}$/.test(value)) {
    throw new Error('Invalid SUPABASE_PROJECT_REF.');
  }
  return value;
}

export function normalizedSupabaseUrl(env: Env): string {
  const raw = env.SUPABASE_URL.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Invalid SUPABASE_URL.');
  }

  const projectRef = normalizedProjectRef(env);
  if (parsed.protocol !== 'https:' || parsed.hostname !== `${projectRef}.supabase.co`) {
    throw new Error('SUPABASE_URL does not match SUPABASE_PROJECT_REF.');
  }
  return parsed.origin;
}

function jwksFor(url: string) {
  const existing = remoteJwksByUrl.get(url);
  if (existing) return existing;
  const created = createRemoteJWKSet(new URL(url), {
    cooldownDuration: 10 * 60 * 1000,
  });
  remoteJwksByUrl.set(url, created);
  return created;
}

export async function verifySupabaseAccessToken(env: Env, token: string): Promise<VerifiedUser> {
  const supabaseUrl = normalizedSupabaseUrl(env);
  const issuer = `${supabaseUrl}/auth/v1`;
  const jwksUrl = `${issuer}/.well-known/jwks.json`;
  const { payload } = await jwtVerify(token, jwksFor(jwksUrl), {
    issuer,
    audience: 'authenticated',
    algorithms: ['ES256', 'RS256'],
  });

  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('JWT subject is missing.');
  }
  if (payload.role !== 'authenticated') {
    throw new Error('JWT role is not authenticated.');
  }

  return { userId: payload.sub, claims: payload };
}

export async function userCanAccessBank(
  env: Env,
  token: string,
  bankId: number,
): Promise<boolean> {
  const supabaseUrl = normalizedSupabaseUrl(env);
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/can_access_question_bank`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ p_bank_id: bankId }),
  });

  if (!response.ok) return false;
  const value = await response.json<unknown>();
  return value === true;
}

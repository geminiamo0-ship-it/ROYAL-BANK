import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { RoyalAiEnv } from './env';

const remoteJwksByUrl = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export type VerifiedUser = {
  userId: string;
  claims: JWTPayload;
};

function normalizedProjectRef(env: RoyalAiEnv): string {
  const value = env.SUPABASE_PROJECT_REF.trim().toLowerCase();
  if (!/^[a-z0-9]{20}$/.test(value)) throw new Error('Invalid SUPABASE_PROJECT_REF.');
  return value;
}

export function normalizedSupabaseUrl(env: RoyalAiEnv): string {
  const raw = env.SUPABASE_URL.trim().replace(/\/+$/, '');
  const parsed = new URL(raw);
  const projectRef = normalizedProjectRef(env);
  if (parsed.protocol !== 'https:' || parsed.hostname !== projectRef + '.supabase.co') {
    throw new Error('SUPABASE_URL does not match SUPABASE_PROJECT_REF.');
  }
  return parsed.origin;
}

function jwksFor(url: string) {
  const existing = remoteJwksByUrl.get(url);
  if (existing) return existing;
  const created = createRemoteJWKSet(new URL(url), { cooldownDuration: 10 * 60 * 1000 });
  remoteJwksByUrl.set(url, created);
  return created;
}

export async function verifySupabaseAccessToken(
  env: RoyalAiEnv,
  token: string,
): Promise<VerifiedUser> {
  const supabaseUrl = normalizedSupabaseUrl(env);
  const issuer = supabaseUrl + '/auth/v1';
  const { payload } = await jwtVerify(
    token,
    jwksFor(issuer + '/.well-known/jwks.json'),
    {
      issuer,
      audience: 'authenticated',
      algorithms: ['ES256', 'RS256'],
    },
  );

  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('JWT subject is missing.');
  if (payload.role !== 'authenticated') throw new Error('JWT role is not authenticated.');
  return { userId: payload.sub, claims: payload };
}

export async function requireSupportRole(
  env: RoyalAiEnv,
  actorId: string,
): Promise<'admin' | 'support'> {
  const base = normalizedSupabaseUrl(env);
  const url = new URL(base + '/rest/v1/profiles');
  url.searchParams.set('id', 'eq.' + actorId);
  url.searchParams.set('select', 'role,is_active');
  url.searchParams.set('limit', '1');

  const response = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY,
      accept: 'application/json',
    },
  });
  if (!response.ok) throw new Error('SUPPORT_ROLE_LOOKUP_FAILED');
  const rows = await response.json<Array<{ role?: string; is_active?: boolean }>>();
  const row = rows[0];
  if (!row?.is_active || (row.role !== 'admin' && row.role !== 'support')) {
    throw new Error('SUPPORT_ACCESS_REQUIRED');
  }
  return row.role;
}

import 'server-only';

import { createHash, createHmac } from 'node:crypto';

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');
const DEFAULT_TIMEOUT_MS = 1800;
const DEFAULT_MAX_JSON_BYTES = 1024 * 1024;
const MEMORY_CACHE_TTL_MS = 5 * 60 * 1000;
const MEMORY_CACHE_MAX_ENTRIES = 512;

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

type MemoryCacheEntry = {
  value: unknown;
  expiresAt: number;
};

const memoryJsonCache = new Map<string, MemoryCacheEntry>();

function readConfig(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID?.trim() || '';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim() || '';
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim() || '';
  const bucket = process.env.R2_BUCKET_NAME?.trim() || '';

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

export function isPrivateR2Configured(): boolean {
  return readConfig() !== null;
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalObjectPath(bucket: string, key: string): string {
  const normalizedKey = key
    .split('/')
    .filter(Boolean)
    .map(encodeRfc3986)
    .join('/');
  return `/${encodeRfc3986(bucket)}/${normalizedKey}`;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function amzTimestamp(now: Date): string {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function signedHeadersForGet(config: R2Config, key: string, now = new Date()) {
  const canonicalUri = canonicalObjectPath(config.bucket, key);
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const amzDate = amzTimestamp(now);
  const dateStamp = amzDate.slice(0, 8);
  const canonicalHeaders = [
    `host:${host}`,
    `x-amz-content-sha256:${EMPTY_SHA256}`,
    `x-amz-date:${amzDate}`,
    '',
  ].join('\n');
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    'GET',
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    EMPTY_SHA256,
  ].join('\n');
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const dateKey = hmac(`AWS4${config.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, 'auto');
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `https://${host}${canonicalUri}`,
    headers: {
      authorization,
      'x-amz-content-sha256': EMPTY_SHA256,
      'x-amz-date': amzDate,
    },
  };
}

function memoryCacheEnabled(): boolean {
  return process.env.ROYAL_R2_MEMORY_CACHE_ENABLED !== 'false';
}

function getMemoryCached<T>(key: string): { hit: true; value: T } | { hit: false } {
  if (!memoryCacheEnabled()) return { hit: false };

  const entry = memoryJsonCache.get(key);
  if (!entry) return { hit: false };

  if (entry.expiresAt <= Date.now()) {
    memoryJsonCache.delete(key);
    return { hit: false };
  }

  memoryJsonCache.delete(key);
  memoryJsonCache.set(key, entry);
  return { hit: true, value: entry.value as T };
}

function setMemoryCached(key: string, value: unknown): void {
  if (!memoryCacheEnabled()) return;

  memoryJsonCache.delete(key);
  memoryJsonCache.set(key, {
    value,
    expiresAt: Date.now() + MEMORY_CACHE_TTL_MS,
  });

  while (memoryJsonCache.size > MEMORY_CACHE_MAX_ENTRIES) {
    const oldestKey = memoryJsonCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    memoryJsonCache.delete(oldestKey);
  }
}

export async function readPrivateR2Json<T>(
  key: string,
  options?: { timeoutMs?: number; maxBytes?: number },
): Promise<T | null> {
  const cached = getMemoryCached<T>(key);
  if (cached.hit) return cached.value;

  const config = readConfig();
  if (!config) throw new Error('Private R2 is not configured.');

  const signed = signedHeadersForGet(config, key);
  const response = await fetch(signed.url, {
    method: 'GET',
    cache: 'no-store',
    headers: signed.headers,
    signal: AbortSignal.timeout(options?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Private R2 read failed with status ${response.status}.`);

  const contentLength = Number(response.headers.get('content-length') || 0);
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_JSON_BYTES;
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error('Private R2 object exceeded the maximum allowed size.');
  }

  const raw = await response.text();
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    throw new Error('Private R2 object exceeded the maximum allowed size.');
  }

  const parsed = JSON.parse(raw) as T;
  setMemoryCached(key, parsed);
  return parsed;
}

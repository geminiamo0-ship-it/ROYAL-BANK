const DEFAULT_PRODUCTION_EDGE_ROLLOUT_PERCENT = 1;
const MAX_PRODUCTION_EDGE_ROLLOUT_PERCENT = 1;
const BUCKET_COUNT = 10_000;

function parsedRolloutPercent(): number {
  const raw = process.env.ROYAL_EXAM_EDGE_PERCENT?.trim();
  if (!raw) return DEFAULT_PRODUCTION_EDGE_ROLLOUT_PERCENT;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > MAX_PRODUCTION_EDGE_ROLLOUT_PERCENT) {
    return 0;
  }
  return value;
}

function stableBucket(value: string): number {
  // FNV-1a 32-bit: deterministic, fast, and sufficient for rollout bucketing.
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % BUCKET_COUNT;
}

export function productionEdgeRolloutPercent(): number {
  return parsedRolloutPercent();
}

export function productionEdgeRolloutBucket(userId: string): number {
  return stableBucket(userId);
}

export function isInProductionEdgeRollout(userId: string): boolean {
  const percent = parsedRolloutPercent();
  if (percent <= 0) return false;
  return stableBucket(userId) < Math.round(percent * 100);
}

export function jwtSubject(token: string | null): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`;
    const payload = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : null;
  } catch {
    return null;
  }
}

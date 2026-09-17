const DEFAULT_PRODUCTION_EDGE_ROLLOUT_PERCENT = 1;
const BUCKET_COUNT = 10_000;

function parsedRolloutPercent(): number {
  const raw = process.env.ROYAL_EXAM_EDGE_PERCENT?.trim();
  if (!raw) return DEFAULT_PRODUCTION_EDGE_ROLLOUT_PERCENT;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) return 0;
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

export function isInProductionEdgeRollout(userId: string): boolean {
  const percent = parsedRolloutPercent();
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  return stableBucket(userId) < Math.round(percent * 100);
}

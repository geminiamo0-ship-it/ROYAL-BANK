import { DurableObject } from 'cloudflare:workers';
import {
  generateInitialDeepDive,
  type DeepDiveConfig,
  type DeepDiveGeneration,
  type DeepDiveLanguage,
  type DeepDiveTrustedContext,
} from './deep-dive';

type CachedGeneration = DeepDiveGeneration & {
  cacheKey: string;
  createdAt: string;
};

export class DeepDiveCache extends DurableObject<Env> {
  private inFlight: Promise<CachedGeneration> | null = null;

  private async stored(cacheKey: string): Promise<CachedGeneration | null> {
    const row = await this.ctx.storage.get<CachedGeneration>('result');
    if (!row || row.cacheKey !== cacheKey || !row.content) return null;
    return row;
  }

  async getOrGenerate(input: {
    cacheKey: string;
    context: DeepDiveTrustedContext;
    config: DeepDiveConfig;
    language: DeepDiveLanguage;
  }): Promise<{ cacheHit: boolean; generation: CachedGeneration }> {
    const objectKey = this.ctx.id.name;
    if (!objectKey || objectKey !== input.cacheKey) {
      throw new Error('DEEP_DIVE_CACHE_SHARD_MISMATCH');
    }

    const existing = await this.stored(input.cacheKey);
    if (existing) return { cacheHit: true, generation: existing };

    if (this.inFlight) {
      return { cacheHit: true, generation: await this.inFlight };
    }

    this.inFlight = (async () => {
      const secondCheck = await this.stored(input.cacheKey);
      if (secondCheck) return secondCheck;

      const generation = await generateInitialDeepDive(this.env, input.context, input.config, input.language);
      const value: CachedGeneration = {
        ...generation,
        cacheKey: input.cacheKey,
        createdAt: new Date().toISOString(),
      };
      await this.ctx.storage.put('result', value);
      return value;
    })();

    try {
      return { cacheHit: false, generation: await this.inFlight };
    } finally {
      this.inFlight = null;
    }
  }
}

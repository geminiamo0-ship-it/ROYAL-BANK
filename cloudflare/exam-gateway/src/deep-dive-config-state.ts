import { DurableObject } from 'cloudflare:workers';
import {
  DEFAULT_DEEP_DIVE_CONFIG,
  fetchDeepDiveConfigFromSupabase,
  type DeepDiveConfig,
} from './deep-dive';

type StoredConfig = {
  value: DeepDiveConfig;
  refreshedAtMs: number;
};

const REFRESH_AFTER_MS = 60_000;

export class DeepDiveConfigState extends DurableObject<Env> {
  private inFlight: Promise<DeepDiveConfig> | null = null;

  async getConfig(): Promise<DeepDiveConfig> {
    const stored = await this.ctx.storage.get<StoredConfig>('config');
    if (!stored) {
      this.ctx.waitUntil(
        this.refreshFromSupabase().catch((error) => {
          console.error('DEEP_DIVE_CONFIG_BACKGROUND_REFRESH_FAILED', error);
        }),
      );
      return DEFAULT_DEEP_DIVE_CONFIG;
    }

    if (Date.now() - stored.refreshedAtMs >= REFRESH_AFTER_MS) {
      this.ctx.waitUntil(
        this.refreshFromSupabase().catch((error) => {
          console.error('DEEP_DIVE_CONFIG_BACKGROUND_REFRESH_FAILED', error);
        }),
      );
    }
    return stored.value;
  }

  async refreshFromSupabase(): Promise<DeepDiveConfig> {
    if (this.inFlight) return this.inFlight;

    this.inFlight = (async () => {
      const value = await fetchDeepDiveConfigFromSupabase(this.env);
      await this.ctx.storage.put<StoredConfig>('config', {
        value,
        refreshedAtMs: Date.now(),
      });
      return value;
    })();

    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }
}

import type { KVStore } from '@devvit/public-api';
import { KEYS } from './keys';

export interface AIConfig {
  [key: string]: string | boolean | undefined;
  provider?: string;
  apiKey?: string;
  voyageApiKey?: string;
}

export async function getAIConfig(kv: KVStore): Promise<AIConfig | null> {
  const value = await kv.get(KEYS.aiConfig);
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as unknown as AIConfig;
    } catch {
      return null;
    }
  }

  return value as unknown as AIConfig;
}

export async function saveAIConfig(kv: KVStore, config: AIConfig): Promise<void> {
  const payload = JSON.stringify(config);
  if (typeof payload !== 'string') {
    throw new Error('Unable to serialize AI config');
  }
  await kv.put(KEYS.aiConfig, payload);
}

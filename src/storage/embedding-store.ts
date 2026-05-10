import type { KVStore } from '@devvit/public-api';
import { KEYS } from './keys';

export async function saveEmbedding(kv: KVStore, id: string, vector: number[]): Promise<void> {
  await kv.put(KEYS.embedding(id), JSON.stringify(vector));
}

export async function getEmbedding(kv: KVStore, id: string): Promise<number[] | null> {
  const raw = await kv.get(KEYS.embedding(id));
  return raw ? JSON.parse(raw as string) : null;
}

import type { KVStore } from '@devvit/public-api';
import { KEYS } from './keys';
import type { Recommendation } from '../types/recommendation';

export async function saveRecommendation(kv: KVStore, rec: Recommendation): Promise<void> {
  await kv.put(KEYS.recommendation(rec.itemId), JSON.stringify(rec));
  const raw = await kv.get(KEYS.recommendationIndex);
  const ids: string[] = raw ? JSON.parse(raw as string) : [];
  if (!ids.includes(rec.itemId)) ids.push(rec.itemId);
  await kv.put(KEYS.recommendationIndex, JSON.stringify(ids));
}

export async function getRecommendation(kv: KVStore, itemId: string): Promise<Recommendation | null> {
  const raw = await kv.get(KEYS.recommendation(itemId));
  return raw ? JSON.parse(raw as string) : null;
}

export async function getAllRecommendations(kv: KVStore): Promise<Recommendation[]> {
  const raw = await kv.get(KEYS.recommendationIndex);
  if (!raw) return [];
  const ids: string[] = JSON.parse(raw as string);
  const results = await Promise.all(ids.map((id) => getRecommendation(kv, id)));
  return results.filter((r): r is Recommendation => r !== null);
}

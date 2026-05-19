import type { KVStore } from '@devvit/public-api';
import { KEYS } from './keys';
import { parseIndexList } from './index-list';
import type { ConsistencyInsight } from '../types/consistency-insight';

export async function saveInsight(kv: KVStore, insight: ConsistencyInsight): Promise<void> {
  await kv.put(KEYS.insight(insight.id), JSON.stringify(insight));
  const raw = await kv.get(KEYS.insightIndex);
  const ids = parseIndexList(raw);
  if (!ids.includes(insight.id)) ids.push(insight.id);
  await kv.put(KEYS.insightIndex, JSON.stringify(ids));
}

export async function getInsight(kv: KVStore, id: string): Promise<ConsistencyInsight | null> {
  const raw = await kv.get(KEYS.insight(id));
  return raw ? JSON.parse(raw as string) : null;
}

export async function listInsights(kv: KVStore): Promise<ConsistencyInsight[]> {
  const raw = await kv.get(KEYS.insightIndex);
  const ids = parseIndexList(raw);
  if (!ids.length) return [];
  const results = await Promise.all(ids.map((id) => getInsight(kv, id)));
  return results.filter((i): i is ConsistencyInsight => i !== null);
}

export async function acknowledgeInsight(kv: KVStore, id: string): Promise<void> {
  const insight = await getInsight(kv, id);
  if (!insight) return;
  await kv.put(KEYS.insight(id), JSON.stringify({
    ...insight,
    acknowledged: true,
    acknowledgedAt: Date.now(),
  }));
}

export async function clearInsights(kv: KVStore): Promise<void> {
  const raw = await kv.get(KEYS.insightIndex);
  const ids = parseIndexList(raw);
  if (!ids.length) return;
  await Promise.all([
    ...ids.map((id) => kv.delete(KEYS.insight(id))),
    kv.delete(KEYS.insightIndex),
  ]);
}

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

/**
 * Mark a recommendation as actioned by a moderator.
 * After this, the item is filtered out for ALL moderators on next dashboard load.
 * Skip does NOT call this — skipped items stay visible.
 */
export async function markActioned(
  kv: KVStore,
  itemId: string,
  action: 'remove' | 'approve' | 'escalate',
  moderator: string
): Promise<void> {
  const raw = await kv.get(KEYS.recommendation(itemId));
  const base: Partial<Recommendation> = raw
    ? JSON.parse(raw as string)
    : { itemId, suggestedAction: action, riskLevel: 'low', confidenceScore: 0, similarity: 0, rationale: '', generatedAt: 0, matchedPolicyId: null, matchedPolicyTitle: null };
  const updated = {
    ...base,
    itemId,
    actionedAt: Date.now(),
    actionedBy: moderator,
    actionTaken: action,
  };
  await kv.put(KEYS.recommendation(itemId), JSON.stringify(updated));
  // Also ensure it's in the index so getAllRecommendations will see it and filter it
  const rawIndex = await kv.get(KEYS.recommendationIndex);
  const ids: string[] = rawIndex ? JSON.parse(rawIndex as string) : [];
  if (!ids.includes(itemId)) {
    ids.push(itemId);
    await kv.put(KEYS.recommendationIndex, JSON.stringify(ids));
  }
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

/**
 * Remove a single recommendation from the index and KV store.
 * Called when a mod manually handles a post or it no longer appears in the queue.
 */
export async function removeRecommendation(kv: KVStore, itemId: string): Promise<void> {
  await kv.delete(KEYS.recommendation(itemId));
  const raw = await kv.get(KEYS.recommendationIndex);
  if (!raw) return;
  const ids: string[] = JSON.parse(raw as string);
  const updated = ids.filter((id) => id !== itemId);
  await kv.put(KEYS.recommendationIndex, JSON.stringify(updated));
}

/**
 * Removes all stored recommendations that are NOT in activeIds.
 * Called at the start of runQueueProcessor so that posts which have already
 * been removed/approved by a moderator (or deleted by the author) are purged
 * from the dashboard queue on the next refresh.
 */
export async function purgeStaleRecommendations(
  kv: KVStore,
  activeIds: Set<string>
): Promise<number> {
  const raw = await kv.get(KEYS.recommendationIndex);
  if (!raw) return 0;
  const ids: string[] = JSON.parse(raw as string);
  const stale = ids.filter((id) => !activeIds.has(id));
  if (stale.length === 0) return 0;

  await Promise.all(stale.map((id) => kv.delete(KEYS.recommendation(id))));
  const remaining = ids.filter((id) => activeIds.has(id));
  await kv.put(KEYS.recommendationIndex, JSON.stringify(remaining));

  console.log(`purgeStaleRecommendations: removed ${stale.length} stale items: ${stale.join(', ')}`);
  return stale.length;
}

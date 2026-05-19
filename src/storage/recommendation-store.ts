import type { KVStore } from '@devvit/public-api';
import { KEYS } from './keys';
import { parseIndexList } from './index-list';
import type { Recommendation } from '../types/recommendation';

export async function saveRecommendation(kv: KVStore, rec: Recommendation): Promise<void> {
  await kv.put(KEYS.recommendation(rec.itemId), JSON.stringify(rec));
  const raw = await kv.get(KEYS.recommendationIndex);
  const ids = parseIndexList(raw);
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
  const ids = parseIndexList(rawIndex);
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
  const ids = parseIndexList(raw);
  if (!ids.length) return [];
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
  const ids = parseIndexList(raw);
  if (!ids.length) return;
  const updated = ids.filter((id) => id !== itemId);
  await kv.put(KEYS.recommendationIndex, JSON.stringify(updated));
}

/**
 * Removes all stored recommendations that are NOT in activeIds,
 * EXCEPT items that have already been actioned by a moderator — those
 * are kept indefinitely as history.
 * Called at the start of runQueueProcessor so that posts which have been
 * removed/approved by Reddit (not via AMIS) are purged from the active queue.
 */
export async function purgeStaleRecommendations(
  kv: KVStore,
  activeIds: Set<string>
): Promise<number> {
  const raw = await kv.get(KEYS.recommendationIndex);
  const ids = parseIndexList(raw);
  if (!ids.length) return 0;

  // Fetch all recs to determine which can be safely purged
  const recs = await Promise.all(ids.map((id) => getRecommendation(kv, id)));

  // Stale = not in active queue AND not previously actioned by a mod
  const stale = ids.filter((_id, i) => {
    const rec = recs[i];
    if (!rec) return true;  // orphan — purge
    if (rec.actionedAt) return false; // keep as history
    if (rec.autoActed) return false;  // keep AI-acted items as history
    return !activeIds.has(_id);       // purge only if no longer in queue
  });

  if (stale.length === 0) return 0;

  await Promise.all(stale.map((id) => kv.delete(KEYS.recommendation(id))));
  const remaining = ids.filter((id) => !stale.includes(id));
  await kv.put(KEYS.recommendationIndex, JSON.stringify(remaining));

  console.log(`purgeStaleRecommendations: removed ${stale.length} stale items: ${stale.join(', ')}`);
  return stale.length;
}

/**
 * Returns all recommendations that have been explicitly actioned by a mod
 * or auto-acted by AI — i.e. the complete moderation history.
 * Sorted newest-first by actionedAt or generatedAt.
 */
export async function getHistoryRecommendations(kv: KVStore): Promise<Recommendation[]> {
  const all = await getAllRecommendations(kv);
  const history = all.filter((r) => r.actionedAt != null || r.autoActed === true);
  return history.sort((a, b) => {
    const ta = a.actionedAt ?? a.generatedAt ?? 0;
    const tb = b.actionedAt ?? b.generatedAt ?? 0;
    return tb - ta; // newest first
  });
}

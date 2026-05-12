import type { KVStore } from '@devvit/public-api';
import { KEYS } from './keys';
import type { ModDecision } from '../types/mod-decision';

export async function saveDecision(kv: KVStore, decision: ModDecision): Promise<void> {
  await kv.put(KEYS.modDecision(decision.targetId), JSON.stringify(decision));
  const raw = await kv.get(KEYS.modDecisionIndex);
  const ids: string[] = raw ? JSON.parse(raw as string) : [];
  if (!ids.includes(decision.targetId)) ids.push(decision.targetId);
  await kv.put(KEYS.modDecisionIndex, JSON.stringify(ids));
}

export async function getDecision(kv: KVStore, targetId: string): Promise<ModDecision | null> {
  const raw = await kv.get(KEYS.modDecision(targetId));
  return raw ? JSON.parse(raw as string) : null;
}

export async function listDecisions(kv: KVStore): Promise<ModDecision[]> {
  const raw = await kv.get(KEYS.modDecisionIndex);
  if (!raw) return [];
  const ids: string[] = JSON.parse(raw as string);
  const results = await Promise.all(ids.map((id) => getDecision(kv, id)));
  return results.filter((d): d is ModDecision => d !== null);
}

export async function clearDecisions(kv: KVStore): Promise<void> {
  const raw = await kv.get(KEYS.modDecisionIndex);
  if (!raw) return;
  const ids: string[] = JSON.parse(raw as string);
  await Promise.all([
    ...ids.map((id) => kv.delete(KEYS.modDecision(id))),
    kv.delete(KEYS.modDecisionIndex),
  ]);
}

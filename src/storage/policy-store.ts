import type { KVStore } from '@devvit/public-api';
import { KEYS } from './keys';
import type { PolicyObject } from '../types/policy-object';

export async function savePolicy(kv: KVStore, policy: PolicyObject): Promise<void> {
  await kv.put(KEYS.policy(policy.id), JSON.stringify(policy));
}

export async function getPolicy(kv: KVStore, id: string): Promise<PolicyObject | null> {
  const raw = await kv.get(KEYS.policy(id));
  return raw ? JSON.parse(raw as string) : null;
}

export async function getAllPolicies(kv: KVStore): Promise<PolicyObject[]> {
  const raw = await kv.get(KEYS.policyIndex);
  if (!raw) return [];
  const ids: string[] = JSON.parse(raw as string);
  const results = await Promise.all(ids.map((id) => getPolicy(kv, id)));
  return results.filter((p): p is PolicyObject => p !== null);
}

export async function clearPolicies(kv: KVStore): Promise<void> {
  const raw = await kv.get(KEYS.policyIndex);
  if (!raw) return;
  const ids: string[] = JSON.parse(raw as string);
  await Promise.all([
    ...ids.map((id) => kv.delete(KEYS.policy(id))),
    ...ids.map((id) => kv.delete(KEYS.policyEmbedding(id))),
    kv.delete(KEYS.policyIndex),
  ]);
}

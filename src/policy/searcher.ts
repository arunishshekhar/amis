import type { KVStore } from '@devvit/public-api';
import type { PolicyObject } from '../types/policy-object';
import { getAllPolicies } from '../storage/policy-store';
import { KEYS } from '../storage/keys';
import { cosineSimilarity } from '../utils/cosine';

export async function searchPolicies(
  kv: KVStore,
  queryVector: number[],
  topK = 3
): Promise<Array<{ policy: PolicyObject; similarity: number }>> {
  const policies = await getAllPolicies(kv);

  const scored = await Promise.all(
    policies.map(async (policy) => {
      const raw = await kv.get(KEYS.policyEmbedding(policy.id));
      if (!raw) return null;
      const vector: number[] = JSON.parse(raw as string);
      return { policy, similarity: cosineSimilarity(queryVector, vector) };
    })
  );

  return scored
    .filter((r): r is { policy: PolicyObject; similarity: number } => r !== null)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

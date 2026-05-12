import type { KVStore } from '@devvit/public-api';
import type { EmbeddingClient } from '../ai/types';
import type { PolicyObject } from '../types/policy-object';
import { KEYS } from '../storage/keys';

export async function embedAndStorePolicies(
  kv: KVStore,
  client: EmbeddingClient,
  policies: PolicyObject[]
): Promise<void> {
  await Promise.all(
    policies.map(async (policy) => {
      const text = `${policy.title}: ${policy.text}`;
      const [vector] = await client.embed([text]);
      await kv.put(KEYS.policyEmbedding(policy.id), JSON.stringify(vector));
    })
  );
  await kv.put(KEYS.policyIndex, JSON.stringify(policies.map((p) => p.id)));
}

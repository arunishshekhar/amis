import type { KVStore } from '@devvit/public-api';
import type { VoyageAIClient } from 'voyageai';
import type { PolicyObject } from '../types/policy-object';
import { embedText } from '../embeddings/client';
import { KEYS } from '../storage/keys';

export async function embedAndStorePolicies(
  kv: KVStore,
  client: VoyageAIClient,
  policies: PolicyObject[]
): Promise<void> {
  await Promise.all(
    policies.map(async (policy) => {
      const text = `${policy.title}: ${policy.text}`;
      const vector = await embedText(client, text);
      await kv.put(KEYS.policyEmbedding(policy.id), JSON.stringify(vector));
    })
  );
  await kv.put(KEYS.policyIndex, JSON.stringify(policies.map((p) => p.id)));
}

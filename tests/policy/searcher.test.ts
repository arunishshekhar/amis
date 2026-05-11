import { searchPolicies } from '../../src/policy/searcher';
import { KEYS } from '../../src/storage/keys';
import type { PolicyObject } from '../../src/types/policy-object';

const p1: PolicyObject = { id: 'rule:0', source: 'rule', title: 'No spam', text: 'No spam', metadata: {} };
const p2: PolicyObject = { id: 'rule:1', source: 'rule', title: 'Be civil', text: 'Be civil', metadata: {} };
const p3: PolicyObject = { id: 'rule:2', source: 'rule', title: 'No repost', text: 'No reposts', metadata: {} };

const makeKv = (policies: PolicyObject[], embeddings: Record<string, number[]>) => {
  const store: Record<string, string> = {
    [KEYS.policyIndex]: JSON.stringify(policies.map((p) => p.id)),
  };
  for (const p of policies) {
    store[KEYS.policy(p.id)] = JSON.stringify(p);
  }
  for (const [id, vec] of Object.entries(embeddings)) {
    store[KEYS.policyEmbedding(id)] = JSON.stringify(vec);
  }
  return {
    get: jest.fn(async (k: string) => store[k] ?? undefined),
    put: jest.fn(),
  };
};

describe('searchPolicies', () => {
  it('returns top-K results sorted by similarity descending', async () => {
    const kv = makeKv(
      [p1, p2, p3],
      {
        'rule:0': [1, 0, 0],
        'rule:1': [0, 1, 0],
        'rule:2': [0.9, 0.1, 0],
      }
    );

    // Query vector similar to rule:0
    const results = await searchPolicies(kv as any, [1, 0, 0], 2);

    expect(results).toHaveLength(2);
    expect(results[0].policy.id).toBe('rule:0');
    expect(results[0].similarity).toBeCloseTo(1.0);
    expect(results[1].policy.id).toBe('rule:2');
    expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
  });

  it('returns fewer than K results when fewer policies exist', async () => {
    const kv = makeKv([p1], { 'rule:0': [1, 0, 0] });
    const results = await searchPolicies(kv as any, [1, 0, 0], 5);
    expect(results).toHaveLength(1);
  });

  it('skips policies whose embeddings are missing', async () => {
    const kv = makeKv([p1, p2], { 'rule:0': [1, 0, 0] }); // p2 has no embedding
    const results = await searchPolicies(kv as any, [1, 0, 0], 3);
    expect(results).toHaveLength(1);
    expect(results[0].policy.id).toBe('rule:0');
  });

  it('returns empty array when policy store is empty', async () => {
    const kv = makeKv([], {});
    const results = await searchPolicies(kv as any, [1, 0, 0], 3);
    expect(results).toEqual([]);
  });
});

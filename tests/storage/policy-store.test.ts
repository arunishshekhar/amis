import {
  savePolicy,
  getPolicy,
  getAllPolicies,
  clearPolicies,
} from '../../src/storage/policy-store';
import { KEYS } from '../../src/storage/keys';
import type { PolicyObject } from '../../src/types/policy-object';

const mockPolicy: PolicyObject = {
  id: 'rule:0',
  source: 'rule',
  title: 'No spam',
  text: 'No spam: Do not post spam.',
  metadata: { priority: '0' },
};

const makeKv = () => {
  const store: Record<string, unknown> = {};
  return {
    put: jest.fn(async (k: string, v: unknown) => { store[k] = v; }),
    get: jest.fn(async (k: string) => store[k] ?? undefined),
    delete: jest.fn(async (k: string) => { delete store[k]; }),
  };
};

describe('savePolicy / getPolicy', () => {
  it('stores and retrieves a PolicyObject by id', async () => {
    const kv = makeKv();
    await savePolicy(kv as any, mockPolicy);
    expect(kv.put).toHaveBeenCalledWith(KEYS.policy('rule:0'), JSON.stringify(mockPolicy));
    const result = await getPolicy(kv as any, 'rule:0');
    expect(result).toEqual(mockPolicy);
  });

  it('returns null for an unknown id', async () => {
    const kv = makeKv();
    expect(await getPolicy(kv as any, 'nope')).toBeNull();
  });
});

describe('getAllPolicies', () => {
  it('returns all policies listed in policyIndex', async () => {
    const kv = makeKv();
    await kv.put(KEYS.policy('rule:0'), JSON.stringify(mockPolicy));
    await kv.put(KEYS.policyIndex, JSON.stringify(['rule:0']));
    const results = await getAllPolicies(kv as any);
    expect(results).toEqual([mockPolicy]);
  });

  it('returns empty array when index is missing', async () => {
    const kv = makeKv();
    expect(await getAllPolicies(kv as any)).toEqual([]);
  });

  it('returns empty array when index is malformed', async () => {
    const kv = makeKv();
    await kv.put(KEYS.policyIndex, JSON.stringify({ id: 'rule:0' }));
    expect(await getAllPolicies(kv as any)).toEqual([]);
  });

  it('supports legacy single-id indexes', async () => {
    const kv = makeKv();
    await kv.put(KEYS.policy('rule:0'), JSON.stringify(mockPolicy));
    await kv.put(KEYS.policyIndex, 'rule:0');
    expect(await getAllPolicies(kv as any)).toEqual([mockPolicy]);
  });
});

describe('clearPolicies', () => {
  it('deletes all policy, embedding, and index keys', async () => {
    const kv = makeKv();
    await kv.put(KEYS.policy('rule:0'), JSON.stringify(mockPolicy));
    await kv.put(KEYS.policyEmbedding('rule:0'), JSON.stringify([0.1, 0.2]));
    await kv.put(KEYS.policyIndex, JSON.stringify(['rule:0']));

    await clearPolicies(kv as any);

    expect(await kv.get(KEYS.policy('rule:0'))).toBeUndefined();
    expect(await kv.get(KEYS.policyEmbedding('rule:0'))).toBeUndefined();
    expect(await kv.get(KEYS.policyIndex)).toBeUndefined();
  });

  it('no-ops when index is missing', async () => {
    const kv = makeKv();
    await expect(clearPolicies(kv as any)).resolves.toBeUndefined();
  });

  it('deletes malformed policy index without throwing', async () => {
    const kv = makeKv();
    await kv.put(KEYS.policyIndex, JSON.stringify({ id: 'rule:0' }));
    await expect(clearPolicies(kv as any)).resolves.toBeUndefined();
    expect(await kv.get(KEYS.policyIndex)).toBeUndefined();
  });
});

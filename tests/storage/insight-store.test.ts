import {
  saveInsight,
  getInsight,
  listInsights,
  acknowledgeInsight,
  clearInsights,
} from '../../src/storage/insight-store';
import { KEYS } from '../../src/storage/keys';
import type { ConsistencyInsight } from '../../src/types/consistency-insight';

const makeKv = () => {
  const store: Record<string, unknown> = {};
  return {
    put: jest.fn(async (k: string, v: unknown) => { store[k] = v; }),
    get: jest.fn(async (k: string) => store[k] ?? undefined),
    delete: jest.fn(async (k: string) => { delete store[k]; }),
  };
};

const sample: ConsistencyInsight = {
  id: 'insight_1000_divergence',
  type: 'divergence',
  detectedAt: 1000000,
  policyId: 'p1',
  policyTitle: 'No Spam',
  description: 'Inconsistent enforcement detected.',
  stats: { removeCount: 7, approveCount: 3, divergenceRatio: 0.3 },
  acknowledged: false,
  acknowledgedAt: null,
};

describe('saveInsight / getInsight', () => {
  it('saves and retrieves a ConsistencyInsight', async () => {
    const kv = makeKv();
    await saveInsight(kv as any, sample);
    expect(kv.put).toHaveBeenCalledWith(KEYS.insight('insight_1000_divergence'), JSON.stringify(sample));
    const result = await getInsight(kv as any, 'insight_1000_divergence');
    expect(result).toEqual(sample);
  });

  it('returns null for unknown id', async () => {
    const kv = makeKv();
    expect(await getInsight(kv as any, 'nope')).toBeNull();
  });
});

describe('listInsights', () => {
  it('returns all saved insights', async () => {
    const kv = makeKv();
    await saveInsight(kv as any, sample);
    await saveInsight(kv as any, { ...sample, id: 'insight_2000_drift', type: 'drift' as const });
    const list = await listInsights(kv as any);
    expect(list).toHaveLength(2);
  });

  it('returns empty array when no insights stored', async () => {
    const kv = makeKv();
    expect(await listInsights(kv as any)).toEqual([]);
  });

  it('returns empty array when index is malformed', async () => {
    const kv = makeKv();
    await kv.put(KEYS.insightIndex, JSON.stringify({ id: 'insight_1000_divergence' }));
    expect(await listInsights(kv as any)).toEqual([]);
  });

  it('supports legacy single-id indexes', async () => {
    const kv = makeKv();
    await kv.put(KEYS.insight('insight_1000_divergence'), JSON.stringify(sample));
    await kv.put(KEYS.insightIndex, 'insight_1000_divergence');
    expect(await listInsights(kv as any)).toEqual([sample]);
  });
});

describe('acknowledgeInsight', () => {
  it('sets acknowledged=true and acknowledgedAt to a positive number', async () => {
    const kv = makeKv();
    await saveInsight(kv as any, sample);
    await acknowledgeInsight(kv as any, 'insight_1000_divergence');
    const result = await getInsight(kv as any, 'insight_1000_divergence');
    expect(result!.acknowledged).toBe(true);
    expect(result!.acknowledgedAt).toBeGreaterThan(0);
  });

  it('no-ops when insight does not exist', async () => {
    const kv = makeKv();
    await expect(acknowledgeInsight(kv as any, 'nope')).resolves.toBeUndefined();
  });
});

describe('clearInsights', () => {
  it('removes all insights and index', async () => {
    const kv = makeKv();
    await saveInsight(kv as any, sample);
    await clearInsights(kv as any);
    expect(await listInsights(kv as any)).toEqual([]);
    expect(await kv.get(KEYS.insightIndex)).toBeUndefined();
  });

  it('no-ops when index is missing', async () => {
    const kv = makeKv();
    await expect(clearInsights(kv as any)).resolves.toBeUndefined();
  });
});

import {
  saveRecommendation,
  getRecommendation,
  getAllRecommendations,
} from '../../src/storage/recommendation-store';
import { KEYS } from '../../src/storage/keys';
import type { Recommendation } from '../../src/types/recommendation';

const mockRec: Recommendation = {
  itemId: 'p1',
  suggestedAction: 'remove',
  confidenceScore: 95,
  riskLevel: 'high',
  matchedPolicyId: 'rule:0',
  matchedPolicyTitle: 'No spam',
  similarity: 0.91,
  rationale: 'Likely violates "No spam". Matched at 91% similarity. Risk level: high.',
  generatedAt: 1000,
};

const makeKv = () => {
  const store: Record<string, unknown> = {};
  return {
    put: jest.fn(async (k: string, v: unknown) => { store[k] = v; }),
    get: jest.fn(async (k: string) => store[k] ?? undefined),
    delete: jest.fn(async (k: string) => { delete store[k]; }),
  };
};

describe('saveRecommendation / getRecommendation', () => {
  it('stores and retrieves a Recommendation by itemId', async () => {
    const kv = makeKv();
    await saveRecommendation(kv as any, mockRec);
    expect(kv.put).toHaveBeenCalledWith(KEYS.recommendation('p1'), JSON.stringify(mockRec));
    const result = await getRecommendation(kv as any, 'p1');
    expect(result).toEqual(mockRec);
  });

  it('returns null for unknown itemId', async () => {
    const kv = makeKv();
    expect(await getRecommendation(kv as any, 'nope')).toBeNull();
  });

  it('adds itemId to recommendationIndex on first save', async () => {
    const kv = makeKv();
    await saveRecommendation(kv as any, mockRec);
    const raw = await kv.get(KEYS.recommendationIndex);
    expect(JSON.parse(raw as string)).toContain('p1');
  });

  it('does not duplicate itemId in index on repeated save', async () => {
    const kv = makeKv();
    await saveRecommendation(kv as any, mockRec);
    await saveRecommendation(kv as any, { ...mockRec, confidenceScore: 90 });
    const raw = await kv.get(KEYS.recommendationIndex);
    const ids: string[] = JSON.parse(raw as string);
    expect(ids.filter((id) => id === 'p1')).toHaveLength(1);
  });
});

describe('getAllRecommendations', () => {
  it('returns all recommendations listed in recommendationIndex', async () => {
    const kv = makeKv();
    await saveRecommendation(kv as any, mockRec);
    const results = await getAllRecommendations(kv as any);
    expect(results).toEqual([mockRec]);
  });

  it('returns empty array when index is missing', async () => {
    const kv = makeKv();
    expect(await getAllRecommendations(kv as any)).toEqual([]);
  });

  it('returns empty array when index is malformed', async () => {
    const kv = makeKv();
    await kv.put(KEYS.recommendationIndex, JSON.stringify({ itemId: 'p1' }));
    expect(await getAllRecommendations(kv as any)).toEqual([]);
  });

  it('supports legacy single-id indexes', async () => {
    const kv = makeKv();
    await kv.put(KEYS.recommendation('p1'), JSON.stringify(mockRec));
    await kv.put(KEYS.recommendationIndex, 'p1');
    expect(await getAllRecommendations(kv as any)).toEqual([mockRec]);
  });
});

import { runRecommendationEngine } from '../../src/recommendations/engine';
import { KEYS } from '../../src/storage/keys';
import type { ModItem } from '../../src/types/mod-item';
import type { PolicyObject } from '../../src/types/policy-object';

const mockItem: ModItem = {
  id: 'p1',
  author: 'alice',
  timestamp: 1000,
  title: 'Buy cheap meds',
  body: 'Discount meds at example.com',
  reportReasons: ['spam'],
  contentType: 'post',
  subredditId: 't5_abc',
  editedAt: 0,
};

const mockPolicy: PolicyObject = {
  id: 'rule:0',
  source: 'rule',
  title: 'No spam',
  text: 'No spam',
  metadata: {},
};

// Cosine similarity between [1,0,0] and [0.99,0.1,0] is ~0.995 → remove/high.
const makeFullKv = () => {
  const store: Record<string, string> = {
    [KEYS.modItemIndex]: JSON.stringify(['p1']),
    [KEYS.modItem('p1')]: JSON.stringify(mockItem),
    [KEYS.embedding('p1')]: JSON.stringify([1, 0, 0]),
    [KEYS.policyIndex]: JSON.stringify(['rule:0']),
    [KEYS.policy('rule:0')]: JSON.stringify(mockPolicy),
    [KEYS.policyEmbedding('rule:0')]: JSON.stringify([0.99, 0.1, 0]),
  };
  return {
    put: jest.fn(async (k: string, v: string) => { store[k] = v; }),
    get: jest.fn(async (k: string) => store[k] ?? undefined),
    delete: jest.fn(),
  };
};

describe('runRecommendationEngine', () => {
  it('processes all items and returns accurate summary counts', async () => {
    const kv = makeFullKv();
    const summary = await runRecommendationEngine(kv as any);
    expect(summary.processed).toBe(1);
    const total = summary.removed + summary.monitored + summary.approved + summary.escalated;
    expect(total).toBe(1);
  });

  it('persists a Recommendation for each processed item', async () => {
    const kv = makeFullKv();
    await runRecommendationEngine(kv as any);
    const rec = await kv.get(KEYS.recommendation('p1'));
    expect(rec).toBeDefined();
    const parsed = JSON.parse(rec as string);
    expect(parsed.itemId).toBe('p1');
    expect(parsed.suggestedAction).toBeDefined();
    expect(parsed.rationale).toBeDefined();
  });

  it('returns remove in summary for a high-similarity match', async () => {
    const kv = makeFullKv();
    const summary = await runRecommendationEngine(kv as any);
    // similarity ~0.995 >= 0.85 → remove
    expect(summary.removed).toBe(1);
    expect(summary.monitored).toBe(0);
    expect(summary.approved).toBe(0);
  });

  it('skips items with no stored embedding and does not count them as processed', async () => {
    const store: Record<string, string> = {
      [KEYS.modItemIndex]: JSON.stringify(['p1', 'p2']),
      [KEYS.modItem('p1')]: JSON.stringify(mockItem),
      [KEYS.embedding('p1')]: JSON.stringify([1, 0, 0]),
      [KEYS.modItem('p2')]: JSON.stringify({ ...mockItem, id: 'p2' }),
      // p2 has NO embedding stored
      [KEYS.policyIndex]: JSON.stringify(['rule:0']),
      [KEYS.policy('rule:0')]: JSON.stringify(mockPolicy),
      [KEYS.policyEmbedding('rule:0')]: JSON.stringify([0.99, 0.1, 0]),
    };
    const kv = {
      put: jest.fn(async (k: string, v: string) => { store[k] = v; }),
      get: jest.fn(async (k: string) => store[k] ?? undefined),
      delete: jest.fn(),
    };
    const summary = await runRecommendationEngine(kv as any);
    expect(summary.processed).toBe(1); // p2 skipped
  });

  it('returns all-zero summary when mod item index is empty', async () => {
    const store: Record<string, string> = {
      [KEYS.modItemIndex]: JSON.stringify([]),
    };
    const kv = {
      put: jest.fn(),
      get: jest.fn(async (k: string) => store[k] ?? undefined),
      delete: jest.fn(),
    };
    const summary = await runRecommendationEngine(kv as any);
    expect(summary.processed).toBe(0);
    expect(summary.removed).toBe(0);
    expect(summary.monitored).toBe(0);
    expect(summary.approved).toBe(0);
    expect(summary.escalated).toBe(0);
  });
});

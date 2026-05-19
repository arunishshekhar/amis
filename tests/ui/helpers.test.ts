import {
  sortItemsByRisk,
  riskColor,
  confidenceColor,
  truncate,
  formatStats,
  sortedInsights,
} from '../../src/shared/dashboard-helpers';
import type { Recommendation } from '../../src/types/recommendation';
import type { ConsistencyInsight } from '../../src/types/consistency-insight';

function makeRec(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    itemId: 'i1',
    suggestedAction: 'remove',
    confidenceScore: 80,
    riskLevel: 'low',
    matchedPolicyId: null,
    matchedPolicyTitle: null,
    similarity: 0.8,
    rationale: 'test',
    generatedAt: Date.now(),
    ...overrides,
  };
}

function makeInsight(id: string, acknowledged: boolean, detectedAt: number): ConsistencyInsight {
  return {
    id,
    type: 'divergence',
    detectedAt,
    policyId: null,
    policyTitle: null,
    description: '',
    stats: {},
    acknowledged,
    acknowledgedAt: null,
  };
}

describe('sortItemsByRisk', () => {
  it('sorts high before medium before low', () => {
    const recs = [
      makeRec({ itemId: 'a', riskLevel: 'low', confidenceScore: 90 }),
      makeRec({ itemId: 'b', riskLevel: 'high', confidenceScore: 70 }),
      makeRec({ itemId: 'c', riskLevel: 'medium', confidenceScore: 80 }),
    ];
    expect(sortItemsByRisk(recs).map((r) => r.itemId)).toEqual(['b', 'c', 'a']);
  });

  it('breaks risk ties by confidenceScore descending', () => {
    const recs = [
      makeRec({ itemId: 'a', riskLevel: 'high', confidenceScore: 70 }),
      makeRec({ itemId: 'b', riskLevel: 'high', confidenceScore: 90 }),
    ];
    expect(sortItemsByRisk(recs)[0].itemId).toBe('b');
  });

  it('does not mutate the original array', () => {
    const recs = [makeRec({ riskLevel: 'low' }), makeRec({ riskLevel: 'high' })];
    sortItemsByRisk(recs);
    expect(recs[0].riskLevel).toBe('low');
  });
});

describe('riskColor', () => {
  it('returns red for high', () => expect(riskColor('high')).toBe('#ff4444'));
  it('returns orange for medium', () => expect(riskColor('medium')).toBe('#ff8c00'));
  it('returns green for low', () => expect(riskColor('low')).toBe('#44bb44'));
});

describe('confidenceColor', () => {
  it('returns orange for score < 70', () => expect(confidenceColor(69)).toBe('#ff8c00'));
  it('returns grey for score >= 70', () => expect(confidenceColor(70)).toBe('#cccccc'));
  it('returns grey for score 100', () => expect(confidenceColor(100)).toBe('#cccccc'));
});

describe('truncate', () => {
  it('truncates strings longer than n with ellipsis', () => {
    expect(truncate('hello world', 5)).toBe('hello…');
  });
  it('returns string unchanged when <= n chars', () => {
    expect(truncate('hi', 5)).toBe('hi');
  });
  it('returns string unchanged when exactly n chars', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });
});

describe('formatStats', () => {
  it('formats integer stats without decimal places', () => {
    expect(formatStats({ removeCount: 7, approveCount: 3 })).toBe(
      'removeCount: 7 · approveCount: 3'
    );
  });

  it('formats float stats to 2 decimal places', () => {
    expect(formatStats({ ratio: 0.3 })).toBe('ratio: 0.30');
  });

  it('returns empty string for empty stats', () => {
    expect(formatStats({})).toBe('');
  });
});

describe('sortedInsights', () => {
  it('puts unacknowledged insights before acknowledged ones', () => {
    const insights = [
      makeInsight('a', true, 100),
      makeInsight('b', false, 50),
    ];
    expect(sortedInsights(insights)[0].id).toBe('b');
  });

  it('sorts by detectedAt descending within same acknowledged state', () => {
    const insights = [
      makeInsight('a', false, 100),
      makeInsight('b', false, 200),
    ];
    expect(sortedInsights(insights)[0].id).toBe('b');
  });

  it('does not mutate the original array', () => {
    const insights = [makeInsight('a', true, 100), makeInsight('b', false, 50)];
    sortedInsights(insights);
    expect(insights[0].id).toBe('a');
  });
});

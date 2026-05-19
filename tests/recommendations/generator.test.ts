import { generateRecommendation } from '../../src/recommendations/generator';
import type { ModItem } from '../../src/types/mod-item';
import type { PolicyObject } from '../../src/types/policy-object';

const makeItem = (overrides: Partial<ModItem> = {}): ModItem => ({
  id: 'p1',
  author: 'alice',
  timestamp: 1000,
  title: 'Test Post',
  body: 'Some content',
  reportReasons: [],
  contentType: 'post',
  subredditId: 't5_abc',
  ...overrides,
  editedAt: overrides.editedAt ?? 0,
});

const makePolicy = (id = 'rule:0', title = 'No spam'): PolicyObject => ({
  id,
  source: 'rule',
  title,
  text: 'No spam allowed.',
  metadata: {},
});

describe('generateRecommendation — action branches', () => {
  it('returns remove/high when similarity >= 0.85', () => {
    const result = generateRecommendation(makeItem(), [{ policy: makePolicy(), similarity: 0.9 }]);
    expect(result.suggestedAction).toBe('remove');
    expect(result.riskLevel).toBe('high');
    expect(result.confidenceScore).toBe(Math.round(60 + 0.9 * 40));
    expect(result.matchedPolicyId).toBe('rule:0');
    expect(result.matchedPolicyTitle).toBe('No spam');
    expect(result.rationale).toContain('No spam');
    expect(result.rationale).toContain('90%');
  });

  it('returns remove/medium when 0.65 <= similarity < 0.75', () => {
    const result = generateRecommendation(makeItem(), [{ policy: makePolicy(), similarity: 0.7 }]);
    expect(result.suggestedAction).toBe('remove');
    expect(result.riskLevel).toBe('medium');
    expect(result.confidenceScore).toBe(Math.round(40 + 0.7 * 50));
    expect(result.rationale).toContain('medium');
  });

  it('returns monitor/medium when 0.60 <= similarity < 0.65', () => {
    const result = generateRecommendation(makeItem(), [{ policy: makePolicy(), similarity: 0.6 }]);
    expect(result.suggestedAction).toBe('monitor');
    expect(result.riskLevel).toBe('medium');
    expect(result.confidenceScore).toBe(Math.round(20 + 0.6 * 40));
    expect(result.rationale).toContain('Possible concern');
  });

  it('returns approve/low when similarity < 0.50', () => {
    const result = generateRecommendation(makeItem(), [{ policy: makePolicy(), similarity: 0.3 }]);
    expect(result.suggestedAction).toBe('approve');
    expect(result.riskLevel).toBe('low');
    expect(result.confidenceScore).toBe(80);
    expect(result.rationale).toContain('No strong policy match');
  });

  it('returns approve/low when policyMatches is empty', () => {
    const result = generateRecommendation(makeItem(), []);
    expect(result.suggestedAction).toBe('approve');
    expect(result.riskLevel).toBe('low');
    expect(result.confidenceScore).toBe(80);
    expect(result.matchedPolicyId).toBeNull();
    expect(result.matchedPolicyTitle).toBeNull();
    expect(result.rationale).toContain('No strong policy match');
  });
});

describe('generateRecommendation — escalation override', () => {
  it('escalates when reportReasons.length >= 3 and similarity >= 0.50', () => {
    const item = makeItem({ reportReasons: ['spam', 'harassment', 'misinformation'] });
    const result = generateRecommendation(item, [{ policy: makePolicy(), similarity: 0.72 }]);
    expect(result.suggestedAction).toBe('escalate');
    expect(result.rationale).toContain('escalation');
    expect(result.rationale).toContain('No spam');
  });

  it('does not escalate when reportReasons.length >= 3 but similarity < 0.50', () => {
    const item = makeItem({ reportReasons: ['spam', 'harassment', 'misinformation'] });
    const result = generateRecommendation(item, [{ policy: makePolicy(), similarity: 0.3 }]);
    expect(result.suggestedAction).toBe('approve');
  });

  it('does not escalate when similarity >= 0.50 but reportReasons.length < 3', () => {
    const item = makeItem({ reportReasons: ['spam', 'harassment'] });
    const result = generateRecommendation(item, [{ policy: makePolicy(), similarity: 0.72 }]);
    expect(result.suggestedAction).toBe('remove');
  });
});

describe('generateRecommendation — confidence and metadata', () => {
  it('caps confidence at 100', () => {
    const item = makeItem({ reportReasons: ['a', 'b', 'c'] });
    const result = generateRecommendation(item, [{ policy: makePolicy(), similarity: 1.0 }]);
    expect(result.confidenceScore).toBeLessThanOrEqual(100);
  });

  it('sets itemId from the ModItem', () => {
    const result = generateRecommendation(makeItem({ id: 'abc' }), []);
    expect(result.itemId).toBe('abc');
  });

  it('sets generatedAt to a current timestamp', () => {
    const before = Date.now();
    const result = generateRecommendation(makeItem(), []);
    expect(result.generatedAt).toBeGreaterThanOrEqual(before);
    expect(result.generatedAt).toBeLessThanOrEqual(Date.now());
  });

  it('sets similarity to 0 when no policy matches', () => {
    const result = generateRecommendation(makeItem(), []);
    expect(result.similarity).toBe(0);
  });

  it('uses the best match similarity (first in sorted array)', () => {
    const matches = [
      { policy: makePolicy('rule:0', 'No spam'), similarity: 0.92 },
      { policy: makePolicy('rule:1', 'Be civil'), similarity: 0.6 },
    ];
    const result = generateRecommendation(makeItem(), matches);
    expect(result.similarity).toBe(0.92);
    expect(result.matchedPolicyId).toBe('rule:0');
  });
});

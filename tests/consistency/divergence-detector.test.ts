import {
  detectDivergence,
  detectDrift,
  calculateVariance,
} from '../../src/consistency/divergence-detector';
import type { ModDecision } from '../../src/types/mod-decision';
import type { Recommendation } from '../../src/types/recommendation';
import type { PolicyObject } from '../../src/types/policy-object';

function makeDecision(
  targetId: string,
  action: ModDecision['action'],
  timestamp = Date.now()
): ModDecision {
  return { targetId, action, moderator: 'mod1', timestamp, subredditId: 'sub1' };
}

function makeRec(itemId: string, policyId: string | null): Recommendation {
  return {
    itemId,
    suggestedAction: 'remove',
    confidenceScore: 90,
    riskLevel: 'high',
    matchedPolicyId: policyId,
    matchedPolicyTitle: policyId ?? null,
    similarity: 0.9,
    rationale: 'test',
    generatedAt: Date.now(),
  };
}

function makePolicy(id: string, title: string): PolicyObject {
  return { id, source: 'rule', title, text: 'policy text', metadata: {} };
}

describe('detectDivergence', () => {
  it('flags a policy group where minority side is >= 20%', () => {
    // 7 removes, 3 approves out of 10 → 30% minority → flagged
    const decisions = [
      ...Array.from({ length: 7 }, (_, i) => makeDecision(`t3_r${i}`, 'removelink')),
      ...Array.from({ length: 3 }, (_, i) => makeDecision(`t3_a${i}`, 'approvelink')),
    ];
    const recs = decisions.map((d) => makeRec(d.targetId, 'p1'));
    const signals = detectDivergence(decisions, recs, [makePolicy('p1', 'No Spam')]);
    expect(signals).toHaveLength(1);
    expect(signals[0].policyId).toBe('p1');
    expect(signals[0].policyTitle).toBe('No Spam');
    expect(signals[0].removeCount).toBe(7);
    expect(signals[0].approveCount).toBe(3);
  });

  it('does NOT flag when minority side is < 20%', () => {
    // 9 removes, 1 approve → 10% minority → not flagged
    const decisions = [
      ...Array.from({ length: 9 }, (_, i) => makeDecision(`t3_r${i}`, 'removelink')),
      makeDecision('t3_a0', 'approvelink'),
    ];
    const recs = decisions.map((d) => makeRec(d.targetId, 'p1'));
    const signals = detectDivergence(decisions, recs, [makePolicy('p1', 'No Spam')]);
    expect(signals).toHaveLength(0);
  });

  it('does NOT flag groups with fewer than 5 decisions', () => {
    const decisions = [
      makeDecision('t3_r0', 'removelink'),
      makeDecision('t3_r1', 'removelink'),
      makeDecision('t3_a0', 'approvelink'),
    ];
    const recs = decisions.map((d) => makeRec(d.targetId, 'p1'));
    const signals = detectDivergence(decisions, recs, [makePolicy('p1', 'No Spam')]);
    expect(signals).toHaveLength(0);
  });

  it('ignores decisions with no matching recommendation', () => {
    const decisions = [makeDecision('t3_unknown', 'removelink')];
    const recs: Recommendation[] = [];
    const signals = detectDivergence(decisions, recs, [makePolicy('p1', 'No Spam')]);
    expect(signals).toHaveLength(0);
  });
});

describe('detectDrift', () => {
  const now = Date.now();
  const recent = now - 10 * 24 * 60 * 60 * 1000;
  const old = now - 60 * 24 * 60 * 60 * 1000;

  it('flags when recent approve rate differs from historical by >= 30 points', () => {
    // Historical (old): 8 removes + 2 approves = 20% approve
    // Recent: 2 removes + 8 approves = 80% approve → delta = 60 → flagged
    const decisions = [
      ...Array.from({ length: 8 }, (_, i) => makeDecision(`t3_or${i}`, 'removelink', old)),
      ...Array.from({ length: 2 }, (_, i) => makeDecision(`t3_oa${i}`, 'approvelink', old)),
      ...Array.from({ length: 2 }, (_, i) => makeDecision(`t3_rr${i}`, 'removelink', recent)),
      ...Array.from({ length: 8 }, (_, i) => makeDecision(`t3_ra${i}`, 'approvelink', recent)),
    ];
    const recs = decisions.map((d) => makeRec(d.targetId, 'p1'));
    const signals = detectDrift(decisions, recs, [makePolicy('p1', 'No Spam')]);
    expect(signals).toHaveLength(1);
    expect(signals[0].delta).toBeGreaterThanOrEqual(0.3);
  });

  it('does NOT flag when delta < 30 percentage points', () => {
    // Historical: 6 removes + 4 approves = 40% approve
    // Recent: 5 removes + 5 approves = 50% approve → delta = 10 → not flagged
    const decisions = [
      ...Array.from({ length: 6 }, (_, i) => makeDecision(`t3_or${i}`, 'removelink', old)),
      ...Array.from({ length: 4 }, (_, i) => makeDecision(`t3_oa${i}`, 'approvelink', old)),
      ...Array.from({ length: 5 }, (_, i) => makeDecision(`t3_rr${i}`, 'removelink', recent)),
      ...Array.from({ length: 5 }, (_, i) => makeDecision(`t3_ra${i}`, 'approvelink', recent)),
    ];
    const recs = decisions.map((d) => makeRec(d.targetId, 'p1'));
    const signals = detectDrift(decisions, recs, [makePolicy('p1', 'No Spam')]);
    expect(signals).toHaveLength(0);
  });
});

describe('calculateVariance', () => {
  it('returns per-policy action rate distributions for groups >= 5', () => {
    const decisions = [
      ...Array.from({ length: 6 }, (_, i) => makeDecision(`t3_r${i}`, 'removelink')),
      ...Array.from({ length: 4 }, (_, i) => makeDecision(`t3_a${i}`, 'approvelink')),
    ];
    const recs = decisions.map((d) => makeRec(d.targetId, 'p1'));
    const signals = calculateVariance(decisions, recs, [makePolicy('p1', 'No Spam')]);
    expect(signals).toHaveLength(1);
    expect(signals[0].policyId).toBe('p1');
    expect(signals[0].removeRate).toBeCloseTo(0.6);
    expect(signals[0].approveRate).toBeCloseTo(0.4);
    expect(signals[0].sampleSize).toBe(10);
  });

  it('excludes groups with fewer than 5 decisions', () => {
    const decisions = Array.from({ length: 3 }, (_, i) =>
      makeDecision(`t3_r${i}`, 'removelink')
    );
    const recs = decisions.map((d) => makeRec(d.targetId, 'p1'));
    const signals = calculateVariance(decisions, recs, [makePolicy('p1', 'No Spam')]);
    expect(signals).toHaveLength(0);
  });
});

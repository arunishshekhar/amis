import { runConsistencyEngine } from '../../src/consistency/engine';
import type { AIProvider } from '../../src/ai/types';
import type { ModDecision } from '../../src/types/mod-decision';

const makeProvider = (): AIProvider => ({
  embedding: { embed: async () => [[0]] },
  textGen: { complete: async () => 'AI insight text' },
});

const makeReddit = () => ({
  getModerationLog: undefined,
  getModeratorActions: undefined,
  getModerationActions: undefined,
});

function makeKvWithDecisions(count: number) {
  const store: Record<string, unknown> = {};
  const ids: string[] = [];

  for (let i = 0; i < count; i++) {
    const d: ModDecision = {
      targetId: `t3_${i}`,
      action: 'removelink',
      moderator: 'mod1',
      timestamp: Date.now() - i * 1000,
      subredditId: 'sub1',
    };
    ids.push(d.targetId);
    store[`moddecision:t3_${i}`] = JSON.stringify(d);
  }
  store['moddecision_index'] = JSON.stringify(ids);
  store['recommendation_index'] = JSON.stringify([]);
  store['policy_index'] = JSON.stringify([]);
  store['insight_index'] = JSON.stringify([]);

  return {
    put: jest.fn(async (k: string, v: unknown) => { store[k] = v; }),
    get: jest.fn(async (k: string) => store[k] ?? undefined),
    delete: jest.fn(async (k: string) => { delete store[k]; }),
  };
}

describe('runConsistencyEngine', () => {
  it('returns skipped=true and decisionCount when fewer than 50 decisions in store', async () => {
    const kv = makeKvWithDecisions(49);
    const summary = await runConsistencyEngine(
      kv as any, makeProvider(), makeReddit() as any, 'test'
    );
    expect(summary.skipped).toBe(true);
    expect(summary.decisionCount).toBe(49);
    expect(summary.insightsGenerated).toBe(0);
  });

  it('returns skipped=false when >= 50 decisions', async () => {
    const kv = makeKvWithDecisions(50);
    const summary = await runConsistencyEngine(
      kv as any, makeProvider(), makeReddit() as any, 'test'
    );
    expect(summary.skipped).toBe(false);
    expect(summary.decisionCount).toBeGreaterThanOrEqual(50);
  });

  it('summary counts match number of signals generated', async () => {
    const kv = makeKvWithDecisions(50);
    const summary = await runConsistencyEngine(
      kv as any, makeProvider(), makeReddit() as any, 'test'
    );
    expect(summary.insightsGenerated).toBe(
      summary.divergenceCount + summary.driftCount + summary.varianceCount
    );
  });
});

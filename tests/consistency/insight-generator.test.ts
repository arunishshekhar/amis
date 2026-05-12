import { generateInsight } from '../../src/consistency/insight-generator';
import type { AIProvider } from '../../src/ai/types';
import type { DivergenceSignal } from '../../src/consistency/divergence-detector';

function makeProvider(response: string): AIProvider {
  return {
    embedding: { embed: async () => [[0]] },
    textGen: { complete: async () => response },
  };
}

function makeCaptureProvider(): { provider: AIProvider; getCaptured: () => { sys: string; user: string } } {
  let captured = { sys: '', user: '' };
  return {
    provider: {
      embedding: { embed: async () => [[0]] },
      textGen: {
        complete: async (sys: string, user: string) => {
          captured = { sys, user };
          return 'captured response';
        },
      },
    },
    getCaptured: () => captured,
  };
}

const divergenceSignal: DivergenceSignal = {
  policyId: 'p1',
  policyTitle: 'No Spam',
  removeCount: 7,
  approveCount: 3,
  divergenceRatio: 0.3,
};

describe('generateInsight', () => {
  it('returns a ConsistencyInsight with AI-generated description', async () => {
    const provider = makeProvider('Inconsistent enforcement detected for the No Spam policy.');
    const insight = await generateInsight(divergenceSignal, 'divergence', provider);
    expect(insight.description).toBe('Inconsistent enforcement detected for the No Spam policy.');
    expect(insight.type).toBe('divergence');
    expect(insight.policyId).toBe('p1');
    expect(insight.policyTitle).toBe('No Spam');
    expect(insight.acknowledged).toBe(false);
    expect(insight.acknowledgedAt).toBeNull();
  });

  it('includes policy title and stats in the user prompt', async () => {
    const { provider, getCaptured } = makeCaptureProvider();
    await generateInsight(divergenceSignal, 'divergence', provider);
    const { user } = getCaptured();
    expect(user).toContain('No Spam');
    expect(user).toContain('7');
    expect(user).toContain('3');
  });

  it('system prompt uses policy-aligned language, not blame language', async () => {
    const { provider, getCaptured } = makeCaptureProvider();
    await generateInsight(divergenceSignal, 'divergence', provider);
    const { sys } = getCaptured();
    expect(sys).toContain('policy alignment');
    expect(sys.toLowerCase()).not.toContain('blame');
    expect(sys.toLowerCase()).not.toContain('bias');
    expect(sys.toLowerCase()).not.toContain('mistake');
  });

  it('stats contain divergence numbers for divergence type', async () => {
    const provider = makeProvider('desc');
    const insight = await generateInsight(divergenceSignal, 'divergence', provider);
    expect(insight.stats.removeCount).toBe(7);
    expect(insight.stats.approveCount).toBe(3);
    expect(insight.stats.divergenceRatio).toBeCloseTo(0.3);
  });

  it('generates a unique id each time', async () => {
    const provider = makeProvider('desc');
    const a = await generateInsight(divergenceSignal, 'divergence', provider);
    const b = await generateInsight(divergenceSignal, 'divergence', provider);
    expect(a.id).not.toBe(b.id);
  });
});

import type { AIProvider } from '../ai/types';
import type { ConsistencyInsight, InsightType } from '../types/consistency-insight';
import type {
  DivergenceSignal,
  DriftSignal,
  VarianceSignal,
} from './divergence-detector';

const SYSTEM_PROMPT =
  'You are a policy alignment analyst for a moderation team. ' +
  'Describe the following enforcement pattern in 2-3 plain sentences. ' +
  'Frame it as operational data focused on policy alignment. ' +
  'Use language like "inconsistent enforcement" or "policy alignment gap". ' +
  'Avoid judgmental language.';

export async function generateInsight(
  signal: DivergenceSignal | DriftSignal | VarianceSignal,
  type: InsightType,
  provider: AIProvider
): Promise<ConsistencyInsight> {
  const userPrompt = JSON.stringify({ type, ...signal });
  const description = await provider.textGen.complete(SYSTEM_PROMPT, userPrompt);

  const stats: Record<string, number> = {};
  if (type === 'divergence') {
    const s = signal as DivergenceSignal;
    stats.removeCount = s.removeCount;
    stats.approveCount = s.approveCount;
    stats.divergenceRatio = s.divergenceRatio;
  } else if (type === 'drift') {
    const s = signal as DriftSignal;
    stats.historicalApproveRate = s.historicalApproveRate;
    stats.recentApproveRate = s.recentApproveRate;
    stats.delta = s.delta;
  } else {
    const s = signal as VarianceSignal;
    stats.removeRate = s.removeRate;
    stats.approveRate = s.approveRate;
    stats.escalateRate = s.escalateRate;
    stats.sampleSize = s.sampleSize;
  }

  return {
    id: `insight_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${type}`,
    type,
    detectedAt: Date.now(),
    policyId: 'policyId' in signal ? (signal as DivergenceSignal).policyId : null,
    policyTitle: 'policyTitle' in signal ? (signal as DivergenceSignal).policyTitle : null,
    description,
    stats,
    acknowledged: false,
    acknowledgedAt: null,
  };
}

import type { KVStore, RedditAPIClient } from '@devvit/public-api';
import type { AIProvider } from '../ai/types';
import { fetchModLog } from './mod-log-fetcher';
import { detectDivergence, detectDrift, calculateVariance } from './divergence-detector';
import { generateInsight } from './insight-generator';
import { saveDecision, listDecisions } from '../storage/mod-decision-store';
import { saveInsight } from '../storage/insight-store';
import { getAllRecommendations } from '../storage/recommendation-store';
import { getAllPolicies } from '../storage/policy-store';

export interface ConsistencySummary {
  insightsGenerated: number;
  divergenceCount: number;
  driftCount: number;
  varianceCount: number;
  skipped: boolean;
  decisionCount: number;
}

export async function runConsistencyEngine(
  kv: KVStore,
  provider: AIProvider,
  reddit: RedditAPIClient,
  subredditName: string
): Promise<ConsistencySummary> {
  const freshDecisions = await fetchModLog(reddit, subredditName);
  await Promise.all(freshDecisions.map((d) => saveDecision(kv, d)));

  const decisions = await listDecisions(kv);
  if (decisions.length < 50) {
    return {
      insightsGenerated: 0,
      divergenceCount: 0,
      driftCount: 0,
      varianceCount: 0,
      skipped: true,
      decisionCount: decisions.length,
    };
  }

  const [recommendations, policies] = await Promise.all([
    getAllRecommendations(kv),
    getAllPolicies(kv),
  ]);

  const divergences = detectDivergence(decisions, recommendations, policies);
  const drifts = detectDrift(decisions, recommendations, policies);
  const variances = calculateVariance(decisions, recommendations, policies);

  let insightsGenerated = 0;

  for (const s of divergences) {
    const insight = await generateInsight(s, 'divergence', provider);
    await saveInsight(kv, insight);
    insightsGenerated++;
  }
  for (const s of drifts) {
    const insight = await generateInsight(s, 'drift', provider);
    await saveInsight(kv, insight);
    insightsGenerated++;
  }
  for (const s of variances) {
    const insight = await generateInsight(s, 'variance', provider);
    await saveInsight(kv, insight);
    insightsGenerated++;
  }

  return {
    insightsGenerated,
    divergenceCount: divergences.length,
    driftCount: drifts.length,
    varianceCount: variances.length,
    skipped: false,
    decisionCount: decisions.length,
  };
}

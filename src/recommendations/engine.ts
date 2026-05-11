import type { KVStore } from '@devvit/public-api';
import { getAllModItemIds, getModItem } from '../storage/mod-item-store';
import { getEmbedding } from '../storage/embedding-store';
import { searchPolicies } from '../policy/searcher';
import { generateRecommendation } from './generator';
import { saveRecommendation } from '../storage/recommendation-store';

export interface RecommendationSummary {
  processed: number;
  removed: number;
  monitored: number;
  approved: number;
  escalated: number;
}

export async function runRecommendationEngine(kv: KVStore): Promise<RecommendationSummary> {
  const summary: RecommendationSummary = {
    processed: 0,
    removed: 0,
    monitored: 0,
    approved: 0,
    escalated: 0,
  };

  const ids = await getAllModItemIds(kv);

  for (const id of ids) {
    const item = await getModItem(kv, id);
    if (!item) continue;

    const vector = await getEmbedding(kv, id);
    if (!vector) {
      console.warn(`runRecommendationEngine: no embedding for item ${id}, skipping`);
      continue;
    }

    const matches = await searchPolicies(kv, vector, 3);
    const rec = generateRecommendation(item, matches);
    await saveRecommendation(kv, rec);

    summary.processed++;
    if (rec.suggestedAction === 'remove') summary.removed++;
    else if (rec.suggestedAction === 'monitor') summary.monitored++;
    else if (rec.suggestedAction === 'escalate') summary.escalated++;
    else summary.approved++;
  }

  return summary;
}

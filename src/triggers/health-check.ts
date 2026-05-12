import type { KVStore, UIClient } from '@devvit/public-api';
import { getAllModItemIds } from '../storage/mod-item-store';
import { getEmbedding } from '../storage/embedding-store';
import { listInsights } from '../storage/insight-store';

export async function runHealthCheck(kv: KVStore, ui: UIClient): Promise<void> {
  const ids = await getAllModItemIds(kv);
  let embeddingCount = 0;
  for (const id of ids) {
    const vec = await getEmbedding(kv, id);
    if (vec) embeddingCount++;
  }
  const insights = await listInsights(kv);
  const pending = insights.filter((i) => !i.acknowledged).length;
  ui.showToast(
    `AMIS: ${ids.length} items, ${embeddingCount} embeddings, ${pending} consistency insights pending`
  );
}

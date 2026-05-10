import type { KVStore } from '@devvit/public-api';
import type { VoyageAIClient } from 'voyageai';
import { fetchModQueue } from '../queue/fetcher';
import { saveModItems } from '../storage/mod-item-store';
import { generateAndStoreEmbeddings } from '../embeddings/generator';

export async function runQueueProcessor(
  subredditName: string,
  kv: KVStore,
  embeddingClient: VoyageAIClient,
  reddit: any
): Promise<void> {
  try {
    const items = await fetchModQueue(reddit, subredditName);
    await saveModItems(kv, items);
    await generateAndStoreEmbeddings(kv, embeddingClient, items);
  } catch (err) {
    console.error('runQueueProcessor failed:', err);
    throw err;
  }
}

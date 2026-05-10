import type { RedditAPIClient, KVStore } from '@devvit/public-api';
import type { VoyageAIClient } from 'voyageai';
import { fetchModQueue } from '../queue/fetcher';
import { saveModItems } from '../storage/mod-item-store';
import { generateAndStoreEmbeddings } from '../embeddings/generator';

export async function runQueueProcessor(
  reddit: RedditAPIClient,
  kv: KVStore,
  embeddingClient: VoyageAIClient
): Promise<void> {
  try {
    // currentSubreddit() is a Devvit runtime API not in public typings
    const subreddit = await (reddit as any).currentSubreddit();
    const items = await fetchModQueue(reddit, subreddit.name);
    await saveModItems(kv, items);
    await generateAndStoreEmbeddings(kv, embeddingClient, items);
  } catch (err) {
    console.error('runQueueProcessor failed:', err);
    throw err;
  }
}

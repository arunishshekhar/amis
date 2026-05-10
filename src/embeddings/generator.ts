import type { KVStore } from '@devvit/public-api';
import type { VoyageAIClient } from 'voyageai';
import type { ModItem } from '../types/mod-item';
import { embedText } from './client';
import { saveEmbedding } from '../storage/embedding-store';

function itemToEmbedInput(item: ModItem): string {
  const parts = [item.title, item.body, ...item.reportReasons].filter(Boolean);
  return parts.join(' | ');
}

export async function generateAndStoreEmbeddings(
  kv: KVStore,
  client: VoyageAIClient,
  items: ModItem[]
): Promise<void> {
  await Promise.all(
    items.map(async (item) => {
      const text = itemToEmbedInput(item);
      const vector = await embedText(client, text);
      await saveEmbedding(kv, item.id, vector);
    })
  );
}

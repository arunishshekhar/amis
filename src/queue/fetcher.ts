import type { RedditAPIClient } from '@devvit/public-api';
import { normalizePost, normalizeComment } from './normalizer';
import type { ModItem } from '../types/mod-item';

export async function fetchModQueue(
  reddit: RedditAPIClient,
  subredditName: string,
  limit = 100
): Promise<ModItem[]> {
  const items: ModItem[] = [];
  const listing = await reddit.getModQueue({ subredditName, limit } as any);
  for await (const item of listing) {
    if ((item as any).type === 'post') {
      items.push(normalizePost(item as any));
    } else if ((item as any).type === 'comment') {
      items.push(normalizeComment(item as any));
    } else {
      console.warn(`fetchModQueue: skipping unknown item type "${(item as any).type}"`);
    }
  }
  return items;
}

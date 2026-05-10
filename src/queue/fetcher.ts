import type { RedditAPIClient } from '@devvit/public-api';
import { normalizePost, normalizeComment } from './normalizer';
import type { ModItem } from '../types/mod-item';

async function collectListing(listing: AsyncIterable<any>): Promise<ModItem[]> {
  const items: ModItem[] = [];
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

export async function fetchModQueue(
  reddit: RedditAPIClient,
  subredditName: string,
  limit = 100
): Promise<ModItem[]> {
  // Devvit gRPC proto uses `subreddit` not `subredditName` as the field name
  const opts = { subreddit: subredditName, limit } as any;

  const [reported, spam, unmoderated] = await Promise.all([
    collectListing(await (reddit as any).getModQueue(opts)),
    collectListing(await (reddit as any).getSpam(opts)),
    collectListing(await (reddit as any).getUnmoderated(opts)),
  ]);

  const seen = new Set<string>();
  const all: ModItem[] = [];
  for (const item of [...reported, ...spam, ...unmoderated]) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      all.push(item);
    }
  }
  return all;
}

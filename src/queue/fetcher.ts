import type { RedditAPIClient } from '@devvit/public-api';
import { normalizePost, normalizeComment } from './normalizer';
import type { ModItem } from '../types/mod-item';

let _debugLogged = false;

async function collectListing(listing: AsyncIterable<any>): Promise<ModItem[]> {
  const items: ModItem[] = [];
  for await (const item of listing) {
    const raw = item as any;
    // Devvit Post objects have a `title` property; Comment objects do not.
    // The `.type` field is NOT set on Devvit API objects.
    if (raw.title !== undefined || raw.postId === undefined) {
      // Treat as a Post (has title, or no parentId/postId indicating comment)
      // Extra guard: skip if no id at all
      if (!raw.id) continue;
      try {
        items.push(normalizePost(raw));
      } catch (e) {
        console.warn(`fetchModQueue: normalizePost failed for id=${raw.id}:`, e);
      }
    } else if (raw.postId !== undefined) {
      // Has postId — it's a Comment
      try {
        items.push(normalizeComment(raw));
      } catch (e) {
        console.warn(`fetchModQueue: normalizeComment failed for id=${raw.id}:`, e);
      }
    } else {
      if (!_debugLogged) {
        _debugLogged = true;
        console.warn(
          `fetchModQueue: unknown item shape — keys: ${Object.keys(raw).join(', ')}`
        );
      }
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

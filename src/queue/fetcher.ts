import type { RedditAPIClient } from '@devvit/public-api';
import { normalizePost, normalizeComment } from './normalizer';
import type { ModItem } from '../types/mod-item';

let _debugLogged = false;

/** Posts older than this are excluded from the unmoderated list to avoid re-analysing stale content. */
const UNMODERATED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function collectListing(listing: AsyncIterable<any>): Promise<ModItem[]> {
  const items: ModItem[] = [];
  for await (const item of listing) {
    const raw = item as any;
    // Devvit Post objects have a `title` property; Comment objects do not.
    if (raw.title !== undefined || raw.postId === undefined) {
      if (!raw.id) continue;
      try {
        items.push(normalizePost(raw));
      } catch (e) {
        console.warn(`fetchModQueue: normalizePost failed for id=${raw.id}:`, e);
      }
    } else if (raw.postId !== undefined) {
      try {
        items.push(normalizeComment(raw));
      } catch (e) {
        console.warn(`fetchModQueue: normalizeComment failed for id=${raw.id}:`, e);
      }
    } else {
      if (!_debugLogged) {
        _debugLogged = true;
        console.warn(`fetchModQueue: unknown item shape — keys: ${Object.keys(raw).join(', ')}`);
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
  const opts = { subreddit: subredditName, limit } as any;
  const cutoff = Date.now() - UNMODERATED_MAX_AGE_MS;

  const [reported, spam, unmoderatedRaw] = await Promise.all([
    collectListing(await (reddit as any).getModQueue(opts)),
    collectListing(await (reddit as any).getSpam(opts)),
    collectListing(await (reddit as any).getUnmoderated(opts)),
  ]);

  // Only include unmoderated posts from the last 7 days.
  // Posts older than that are stale (e.g. old test posts) and clutter the queue.
  const unmoderated = unmoderatedRaw.filter((item) => item.timestamp >= cutoff);
  if (unmoderatedRaw.length !== unmoderated.length) {
    console.log(
      `fetchModQueue: dropped ${unmoderatedRaw.length - unmoderated.length} stale ` +
      `unmoderated post(s) older than 7 days`
    );
  }

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

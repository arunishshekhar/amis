import type { RedditAPIClient } from '@devvit/public-api';
import type { PolicyObject } from '../types/policy-object';

export async function ingestRemovalReasons(
  reddit: RedditAPIClient,
  subredditName: string
): Promise<PolicyObject[]> {
  const raw = await reddit.getSubredditRemovalReasons(subredditName);
  const reasons = normalizeRemovalReasons(raw);
  return reasons.map((reason, index): PolicyObject => {
    const title = reason.title ?? `Removal reason ${index}`;
    return {
      id: `removal_reason:${index}`,
      source: 'removal_reason',
      title,
      text: `${title}: ${reason.message ?? ''}`.trim(),
      metadata: {},
    };
  });
}

function normalizeRemovalReasons(raw: unknown): Array<{ title?: string; message?: string }> {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];

  const values = Object.values(raw as Record<string, unknown>);
  return values.filter((value): value is { title?: string; message?: string } => {
    return Boolean(value) && typeof value === 'object';
  });
}

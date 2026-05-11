import type { RedditAPIClient } from '@devvit/public-api';
import type { PolicyObject } from '../types/policy-object';

export async function ingestRemovalReasons(
  reddit: RedditAPIClient,
  subredditName: string
): Promise<PolicyObject[]> {
  const reasons = await reddit.getSubredditRemovalReasons(subredditName);
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

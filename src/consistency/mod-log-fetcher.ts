import type { RedditAPIClient } from '@devvit/public-api';
import type { ModAction, ModDecision } from '../types/mod-decision';

const TRACKED_ACTIONS = new Set<string>([
  'removelink',
  'approvelink',
  'removecomment',
  'approvecomment',
  'spamlink',
  'spamcomment',
]);

export async function fetchModLog(
  reddit: RedditAPIClient,
  subredditName: string
): Promise<ModDecision[]> {
  try {
    const client = reddit as any;
    const logMethod =
      client.getModerationLog ??
      client.getModeratorActions ??
      client.getModerationActions;
    if (!logMethod) {
      console.warn('fetchModLog: no mod log method found — returning empty');
      return [];
    }
    const entries: any[] = await logMethod.call(client, { subredditName, limit: 100 });
    return entries
      .filter((e) => TRACKED_ACTIONS.has(e.action ?? e.type))
      .map((e): ModDecision => ({
        targetId: e.targetFullname ?? e.targetId ?? e.target_fullname ?? '',
        action: (e.action ?? e.type) as ModAction,
        moderator: e.moderatorName ?? e.mod ?? e.moderator ?? 'unknown',
        timestamp: e.createdAt ?? (e.created_utc ? e.created_utc * 1000 : Date.now()),
        subredditId: e.subredditId ?? e.subreddit_id ?? subredditName,
      }))
      .filter((d) => d.targetId !== '');
  } catch (err) {
    console.error('fetchModLog: failed:', err);
    return [];
  }
}

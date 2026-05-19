import type { RedditAPIClient } from '@devvit/public-api';
import type { SuggestedAction } from '../types/recommendation';

type CommentRecommendation = {
  suggestedAction?: SuggestedAction;
  matchedPolicyTitle?: string | null;
  rationale?: string;
};

export function shouldAlertAuthor(rec: CommentRecommendation): boolean {
  return rec.suggestedAction === 'remove' || rec.suggestedAction === 'monitor' || rec.suggestedAction === 'escalate';
}

export function buildViolationAlert(rec: CommentRecommendation): string {
  const rule = rec.matchedPolicyTitle ?? 'a subreddit rule';
  const reason = rec.rationale?.trim() || 'AMIS detected a likely policy violation.';
  return [
    'Your post may violate this subreddit\'s rules.',
    '',
    `Rule: ${rule}`,
    '',
    `Reason: ${reason}`,
    '',
    'Please review the subreddit rules before posting again. A moderator may still review this decision.',
  ].join('\n');
}

export function buildRemovalComment(rec: CommentRecommendation): string {
  const rule = rec.matchedPolicyTitle ?? 'a subreddit rule';
  const reason = rec.rationale?.trim() || 'AMIS detected a policy violation.';
  return [
    'Your post was removed by AMIS because it appears to violate this subreddit\'s rules.',
    '',
    `Rule: ${rule}`,
    '',
    `Reason: ${reason}`,
    '',
    'If you believe this was a mistake, please contact the moderators.',
  ].join('\n');
}

export function buildRemovalModNote(rec: CommentRecommendation): string {
  const rule = rec.matchedPolicyTitle?.trim() || 'subreddit rules';
  const reason = rec.rationale?.replace(/^\[LLM\]\s*/i, '').trim() || 'AMIS detected a policy violation.';
  const note = `AMIS: ${rule} - ${reason}`.replace(/\s+/g, ' ').trim();

  return note.length <= 100 ? note : `${note.slice(0, 97).trimEnd()}...`;
}

function buildRemovalReasonTitle(rec: CommentRecommendation): string {
  const rule = rec.matchedPolicyTitle?.trim() || 'subreddit rules';
  const title = `AMIS: ${rule}`.replace(/\s+/g, ' ').trim();
  return title.length <= 80 ? title : `${title.slice(0, 77).trimEnd()}...`;
}

function buildRemovalReasonMessage(rec: CommentRecommendation): string {
  const rule = rec.matchedPolicyTitle?.trim() || 'this subreddit\'s rules';
  return [
    `Your post was removed because AMIS detected a likely violation of: ${rule}.`,
    '',
    'A short AMIS note with the specific reason is attached to this removal action for the moderation team.',
    '',
    'If you believe this was a mistake, please contact the moderators.',
  ].join('\n');
}

async function getOrCreateRemovalReasonId(
  reddit: RedditAPIClient,
  subredditName: string,
  rec: CommentRecommendation
): Promise<string> {
  if (!subredditName) return '';
  const title = buildRemovalReasonTitle(rec);
  const reasons = await reddit.getSubredditRemovalReasons(subredditName).catch((err) => {
    console.warn(`addRemovalReasonNote: failed to load removal reasons for r/${subredditName}:`, err);
    return [];
  });
  const existing = reasons.find((reason) => reason.title.trim().toLowerCase() === title.toLowerCase());
  if (existing) return existing.id;

  return reddit.addSubredditRemovalReason(subredditName, {
    title,
    message: buildRemovalReasonMessage(rec),
  });
}

export async function addRemovalReasonNote(
  reddit: RedditAPIClient,
  postId: string,
  rec: CommentRecommendation,
  context: string,
  subredditName = ''
): Promise<void> {
  try {
    const reasonId = await getOrCreateRemovalReasonId(reddit, subredditName, rec);
    await reddit.addRemovalNote({
      itemIds: [postId],
      reasonId,
      modNote: buildRemovalModNote(rec),
    });
    console.log(`${context}: added Reddit removal reason note to post ${postId}`);
  } catch (err) {
    console.warn(`${context}: failed to add Reddit removal reason note to post ${postId}:`, err);
  }
}

export async function commentRemovalAsModerator(
  reddit: RedditAPIClient,
  postId: string,
  rec: CommentRecommendation,
  context: string
): Promise<void> {
  try {
    const comment = await reddit.submitComment({
      id: postId,
      text: buildRemovalComment(rec),
      runAs: 'APP',
    });
    await comment.distinguish(true);
    console.log(`${context}: added distinguished removal comment to post ${postId}`);
  } catch (err) {
    console.warn(`${context}: failed to add distinguished removal comment to post ${postId}:`, err);
  }
}

export async function messageAuthor(
  reddit: RedditAPIClient,
  author: string,
  subject: string,
  text: string,
  context: string
): Promise<void> {
  const username = author.replace(/^u\//i, '').trim();
  if (!username || username === '[deleted]') return;

  try {
    await reddit.sendPrivateMessage({
      to: username,
      subject,
      text,
    });
    console.log(`${context}: messaged u/${username}`);
  } catch (err) {
    console.warn(`${context}: failed to message u/${username}:`, err);
  }
}

export async function commentOnPost(
  reddit: RedditAPIClient,
  postId: string,
  text: string,
  context: string
): Promise<void> {
  try {
    await reddit.submitComment({
      id: postId,
      text,
      runAs: 'APP',
    });
    console.log(`${context}: commented on post ${postId}`);
  } catch (err) {
    console.warn(`${context}: failed to comment on post ${postId}:`, err);
  }
}

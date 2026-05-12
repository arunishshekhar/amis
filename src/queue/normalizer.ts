import type { Post, Comment } from '@devvit/public-api';
import type { ModItem } from '../types/mod-item';

export function normalizePost(post: Post): ModItem {
  const raw = post as any;
  // editedAt is a Date on edited posts; fall back to 0 (unedited)
  const editedAt = raw.editedAt instanceof Date
    ? raw.editedAt.getTime()
    : typeof raw.editedAt === 'number'
      ? raw.editedAt
      : 0;
  return {
    id: post.id,
    author: raw.authorName ?? '',
    timestamp: post.createdAt.getTime(),
    editedAt,
    title: raw.title ?? '',
    body: raw.body ?? '',
    reportReasons: (raw.reports ?? []).map((r: any) => r.reason),
    contentType: 'post',
    subredditId: post.subredditId,
  };
}

export function normalizeComment(comment: Comment): ModItem {
  const raw = comment as any;
  const editedAt = raw.editedAt instanceof Date
    ? raw.editedAt.getTime()
    : typeof raw.editedAt === 'number'
      ? raw.editedAt
      : 0;
  return {
    id: comment.id,
    author: raw.authorName ?? '',
    timestamp: comment.createdAt.getTime(),
    editedAt,
    title: '',
    body: raw.body ?? '',
    reportReasons: (raw.reports ?? []).map((r: any) => r.reason),
    contentType: 'comment',
    subredditId: comment.subredditId,
  };
}

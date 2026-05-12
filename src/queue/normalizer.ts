import type { Post, Comment } from '@devvit/public-api';
import type { ModItem } from '../types/mod-item';

export function normalizePost(post: Post): ModItem {
  const raw = post as any;
  // createdAt may be a Date or a Unix-ms number depending on trigger context
  const timestamp = raw.createdAt instanceof Date
    ? raw.createdAt.getTime()
    : typeof raw.createdAt === 'number'
      ? raw.createdAt
      : 0;
  const editedAt = raw.editedAt instanceof Date
    ? raw.editedAt.getTime()
    : typeof raw.editedAt === 'number'
      ? raw.editedAt
      : 0;
  return {
    id: post.id,
    author: raw.authorName ?? '',
    timestamp,
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
  const timestamp = raw.createdAt instanceof Date
    ? raw.createdAt.getTime()
    : typeof raw.createdAt === 'number'
      ? raw.createdAt
      : 0;
  const editedAt = raw.editedAt instanceof Date
    ? raw.editedAt.getTime()
    : typeof raw.editedAt === 'number'
      ? raw.editedAt
      : 0;
  return {
    id: comment.id,
    author: raw.authorName ?? '',
    timestamp,
    editedAt,
    title: '',
    body: raw.body ?? '',
    reportReasons: (raw.reports ?? []).map((r: any) => r.reason),
    contentType: 'comment',
    subredditId: comment.subredditId,
  };
}

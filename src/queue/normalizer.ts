import type { Post, Comment } from '@devvit/public-api';
import type { ModItem } from '../types/mod-item';

export function normalizePost(post: Post): ModItem {
  return {
    id: post.id,
    author: (post as any).authorName ?? '',
    timestamp: post.createdAt.getTime(),
    title: (post as any).title,
    body: (post as any).body ?? '',
    reportReasons: ((post as any).reports ?? []).map((r: any) => r.reason),
    contentType: 'post',
    subredditId: post.subredditId,
  };
}

export function normalizeComment(comment: Comment): ModItem {
  return {
    id: comment.id,
    author: (comment as any).authorName ?? '',
    timestamp: comment.createdAt.getTime(),
    title: '',
    body: (comment as any).body ?? '',
    reportReasons: ((comment as any).reports ?? []).map((r: any) => r.reason),
    contentType: 'comment',
    subredditId: comment.subredditId,
  };
}

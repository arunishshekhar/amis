import type { Post, Comment } from '@devvit/public-api';
import type { ModItem } from '../types/mod-item';

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function timestampFrom(raw: any): number {
  if (raw.createdAt instanceof Date) return raw.createdAt.getTime();
  if (typeof raw.createdAt === 'number') return raw.createdAt;
  if (typeof raw.createdUtc === 'number') return raw.createdUtc * 1000;
  if (typeof raw.created_utc === 'number') return raw.created_utc * 1000;
  return 0;
}

function editedTimestampFrom(raw: any): number {
  if (raw.editedAt instanceof Date) return raw.editedAt.getTime();
  if (typeof raw.editedAt === 'number') return raw.editedAt;
  if (typeof raw.edited === 'number') return raw.edited * 1000;
  if (typeof raw.editedUtc === 'number') return raw.editedUtc * 1000;
  return 0;
}

function reportReasonsFrom(raw: any): string[] {
  const reports = Array.isArray(raw.reports) ? raw.reports : [];
  const reportReasons = reports
    .map((report: any) => pickString(report?.reason, report?.message, report))
    .filter(Boolean);
  const userReports = Array.isArray(raw.userReportReasons) ? raw.userReportReasons : raw.userReports;
  const modReports = Array.isArray(raw.modReportReasons) ? raw.modReportReasons : raw.modReports;
  const compactReports = [...(Array.isArray(userReports) ? userReports : []), ...(Array.isArray(modReports) ? modReports : [])]
    .map((report: any) => Array.isArray(report) ? pickString(report[0]) : pickString(report))
    .filter(Boolean);
  return Array.from(new Set([...reportReasons, ...compactReports]));
}

export function normalizePost(post: Post): ModItem {
  const raw = post as any;
  return {
    id: post.id,
    author: pickString(raw.authorName, raw.author, raw.author?.username, raw.author?.name),
    timestamp: timestampFrom(raw),
    editedAt: editedTimestampFrom(raw),
    title: pickString(raw.title),
    body: pickString(raw.body, raw.selftext, raw.text),
    reportReasons: reportReasonsFrom(raw),
    contentType: 'post',
    subredditId: pickString(raw.subredditId, raw.subreddit_id),
  };
}

export function normalizeComment(comment: Comment): ModItem {
  const raw = comment as any;
  return {
    id: comment.id,
    author: pickString(raw.authorName, raw.author, raw.author?.username, raw.author?.name),
    timestamp: timestampFrom(raw),
    editedAt: editedTimestampFrom(raw),
    title: '',
    body: pickString(raw.body, raw.text),
    reportReasons: reportReasonsFrom(raw),
    contentType: 'comment',
    subredditId: pickString(raw.subredditId, raw.subreddit_id),
  };
}

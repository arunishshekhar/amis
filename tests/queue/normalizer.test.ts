import { normalizePost, normalizeComment } from '../../src/queue/normalizer';

const BASE = {
  id: 'abc123',
  authorName: 'user1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  subredditId: 't5_xyz',
};

describe('normalizePost', () => {
  it('maps fields to ModItem shape', () => {
    const raw = {
      ...BASE,
      title: 'My Post',
      body: 'Post body',
      reports: [{ reason: 'spam' }, { reason: 'harassment' }],
    };
    const result = normalizePost(raw as any);
    expect(result).toEqual({
      id: 'abc123',
      author: 'user1',
      timestamp: new Date('2026-01-01T00:00:00Z').getTime(),
      title: 'My Post',
      body: 'Post body',
      reportReasons: ['spam', 'harassment'],
      contentType: 'post',
      subredditId: 't5_xyz',
      editedAt: 0,
    });
  });

  it('uses empty string when body is undefined', () => {
    const raw = { ...BASE, title: 'T', body: undefined, reports: [] };
    expect(normalizePost(raw as any).body).toBe('');
  });

  it('maps raw Reddit JSON field names from trigger payloads', () => {
    const raw = {
      id: 't3_post',
      author: 'alice',
      createdUtc: 1770000000,
      edited: 1770000100,
      subreddit_id: 't5_raw',
      title: 'Raw post',
      selftext: 'Raw body',
      userReports: [['spam', 1]],
      modReports: [['rule break', 'mod']],
    };

    const result = normalizePost(raw as any);

    expect(result.author).toBe('alice');
    expect(result.timestamp).toBe(1770000000000);
    expect(result.editedAt).toBe(1770000100000);
    expect(result.body).toBe('Raw body');
    expect(result.subredditId).toBe('t5_raw');
    expect(result.reportReasons).toEqual(['spam', 'rule break']);
  });
});

describe('normalizeComment', () => {
  it('maps fields to ModItem shape with empty title', () => {
    const raw = { ...BASE, body: 'A comment', reports: [] };
    const result = normalizeComment(raw as any);
    expect(result.title).toBe('');
    expect(result.contentType).toBe('comment');
  });
});

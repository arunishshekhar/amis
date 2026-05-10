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
    });
  });

  it('uses empty string when body is undefined', () => {
    const raw = { ...BASE, title: 'T', body: undefined, reports: [] };
    expect(normalizePost(raw as any).body).toBe('');
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

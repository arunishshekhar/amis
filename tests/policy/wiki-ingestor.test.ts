import { ingestWikiPages, chunkText } from '../../src/policy/wiki-ingestor';

describe('chunkText', () => {
  it('returns two chunks when combined paragraphs exceed maxChunkSize', () => {
    const para = 'A'.repeat(300);
    const text = `${para}\n\n${para}`;
    const chunks = chunkText(text, 500);
    // Each para is 300 chars; combined with separator is 602 > 500, so expect 2 chunks
    expect(chunks).toHaveLength(2);
  });

  it('content of two-chunk split matches original paragraphs', () => {
    const para = 'A'.repeat(300);
    const text = `${para}\n\n${para}`;
    const chunks = chunkText(text, 500);
    expect(chunks[0]).toBe(para);
    expect(chunks[1]).toBe(para);
  });

  it('returns one chunk when all paragraphs fit', () => {
    const text = 'Short para one.\n\nShort para two.';
    const chunks = chunkText(text, 500);
    expect(chunks).toHaveLength(1);
  });

  it('returns empty array for empty string', () => {
    expect(chunkText('', 500)).toEqual([]);
  });
});

describe('ingestWikiPages', () => {
  it('chunks a wiki page into PolicyObjects', async () => {
    const reddit = {
      getWikiPage: jest.fn().mockResolvedValue({ content: 'Hello\n\nWorld' }),
    };
    const result = await ingestWikiPages(reddit as any, 'testsubreddit', ['guidelines']);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].source).toBe('wiki');
    expect(result[0].id).toMatch(/^wiki:guidelines:/);
    expect(result[0].metadata).toEqual({ page: 'guidelines' });
  });

  it('skips pages that return an error', async () => {
    const reddit = {
      getWikiPage: jest.fn().mockRejectedValue(new Error('not found')),
    };
    const result = await ingestWikiPages(reddit as any, 'testsubreddit', ['missing-page']);
    expect(result).toEqual([]);
  });

  it('handles multiple pages', async () => {
    const reddit = {
      getWikiPage: jest.fn()
        .mockResolvedValueOnce({ content: 'Page one content' })
        .mockResolvedValueOnce({ content: 'Page two content' }),
    };
    const result = await ingestWikiPages(reddit as any, 'testsubreddit', ['p1', 'p2']);
    expect(result.some((p) => p.id.startsWith('wiki:p1:'))).toBe(true);
    expect(result.some((p) => p.id.startsWith('wiki:p2:'))).toBe(true);
  });

  it('returns empty array for empty page list', async () => {
    const reddit = { getWikiPage: jest.fn() };
    const result = await ingestWikiPages(reddit as any, 'testsubreddit', []);
    expect(result).toEqual([]);
  });
});

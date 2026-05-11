import { parseAutomodConfig } from '../../src/policy/automod-parser';

const makeReddit = (content: string | null) => ({
  getWikiPage: jest.fn().mockResolvedValue(
    content !== null ? { content } : Promise.reject(new Error('not found'))
  ),
});

const makeRedditThrowing = () => ({
  getWikiPage: jest.fn().mockRejectedValue(new Error('wiki page not found')),
});

describe('parseAutomodConfig', () => {
  it('converts each YAML block to a PolicyObject', async () => {
    const yaml = `action: remove\ntype: submission\nbody_text_contains: "spam"`;
    const reddit = makeReddit(yaml);

    const result = await parseAutomodConfig(reddit as any, 'testsubreddit');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'automod:0',
      source: 'automod',
      text: expect.stringContaining('action: remove'),
    });
  });

  it('handles multiple blocks separated by ---', async () => {
    const yaml = `action: remove\ntype: submission\n---\naction: report\ntype: comment`;
    const reddit = makeReddit(yaml);

    const result = await parseAutomodConfig(reddit as any, 'testsubreddit');
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('automod:0');
    expect(result[1].id).toBe('automod:1');
  });

  it('skips malformed blocks and continues', async () => {
    const yaml = `action: remove\n---\n: invalid: yaml: [\n---\naction: report`;
    const reddit = makeReddit(yaml);

    const result = await parseAutomodConfig(reddit as any, 'testsubreddit');
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((p) => p.source === 'automod')).toBe(true);
  });

  it('returns empty array when wiki page is not found', async () => {
    const reddit = makeRedditThrowing();
    const result = await parseAutomodConfig(reddit as any, 'testsubreddit');
    expect(result).toEqual([]);
  });

  it('returns empty array for blank config', async () => {
    const reddit = makeReddit('');
    const result = await parseAutomodConfig(reddit as any, 'testsubreddit');
    expect(result).toEqual([]);
  });

  it('uses the name field as title when present', async () => {
    const yaml = `name: anti-spam\naction: remove\nbody_text_contains: "buy now"`;
    const reddit = makeReddit(yaml);
    const result = await parseAutomodConfig(reddit as any, 'testsubreddit');
    expect(result[0].title).toBe('anti-spam');
  });
});

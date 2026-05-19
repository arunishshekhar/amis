import { ingestRemovalReasons } from '../../src/policy/removal-reason-ingestor';

describe('ingestRemovalReasons', () => {
  it('maps removal reasons to PolicyObjects', async () => {
    const reddit = {
      getSubredditRemovalReasons: jest.fn().mockResolvedValue([
        { id: 'abc', title: 'Spam', message: 'This is spam.' },
        { id: 'def', title: 'Off-topic', message: 'Not related to this subreddit.' },
      ]),
    };

    const result = await ingestRemovalReasons(reddit as any, 'testsubreddit');

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: 'removal_reason:0',
      source: 'removal_reason',
      title: 'Spam',
      text: 'Spam: This is spam.',
      metadata: {},
    });
    expect(result[1]).toEqual({
      id: 'removal_reason:1',
      source: 'removal_reason',
      title: 'Off-topic',
      text: 'Off-topic: Not related to this subreddit.',
      metadata: {},
    });
  });

  it('returns empty array when there are no removal reasons', async () => {
    const reddit = {
      getSubredditRemovalReasons: jest.fn().mockResolvedValue([]),
    };
    const result = await ingestRemovalReasons(reddit as any, 'testsubreddit');
    expect(result).toEqual([]);
  });

  it('maps object-shaped removal reasons to PolicyObjects', async () => {
    const reddit = {
      getSubredditRemovalReasons: jest.fn().mockResolvedValue({
        abc: { title: 'Spam', message: 'This is spam.' },
        def: { title: 'Off-topic', message: 'Not related to this subreddit.' },
      }),
    };
    const result = await ingestRemovalReasons(reddit as any, 'testsubreddit');
    expect(result.map((p) => p.title)).toEqual(['Spam', 'Off-topic']);
  });

  it('returns empty array when removal reasons response is malformed', async () => {
    const reddit = {
      getSubredditRemovalReasons: jest.fn().mockResolvedValue(undefined),
    };
    const result = await ingestRemovalReasons(reddit as any, 'testsubreddit');
    expect(result).toEqual([]);
  });

  it('passes subredditName to the API', async () => {
    const reddit = {
      getSubredditRemovalReasons: jest.fn().mockResolvedValue([]),
    };
    await ingestRemovalReasons(reddit as any, 'mysubreddit');
    expect(reddit.getSubredditRemovalReasons).toHaveBeenCalledWith('mysubreddit');
  });

  it('falls back to "Removal reason N" title when title is missing', async () => {
    const reddit = {
      getSubredditRemovalReasons: jest.fn().mockResolvedValue([
        { id: 'xyz', message: 'Some message.' },
      ]),
    };
    const result = await ingestRemovalReasons(reddit as any, 'testsubreddit');
    expect(result[0].title).toBe('Removal reason 0');
    expect(result[0].text).toBe('Removal reason 0: Some message.');
  });
});

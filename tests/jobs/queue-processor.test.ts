import { runQueueProcessor } from '../../src/jobs/queue-processor';
import type { ModItem } from '../../src/types/mod-item';

const mockItem: ModItem = {
  id: 'p1',
  author: 'alice',
  timestamp: 1000,
  title: 'Test Post',
  body: 'Some content',
  reportReasons: ['spam'],
  contentType: 'post',
  subredditId: 't5_abc',
};

const store: Record<string, string> = {};
const mockKv = {
  put: jest.fn(async (k: string, v: string) => { store[k] = v; }),
  get: jest.fn(async (k: string) => store[k] ?? undefined),
};

const rawItem = {
  ...mockItem,
  type: 'post',
  authorName: 'alice',
  createdAt: new Date(1000),
  reports: [{ reason: 'spam' }],
};

const emptyListing = {
  [Symbol.asyncIterator]: async function* () {},
};

const mockReddit = {
  getModQueue: jest.fn().mockReturnValue({
    [Symbol.asyncIterator]: async function* () { yield rawItem; },
  }),
  getSpam: jest.fn().mockReturnValue(emptyListing),
  getUnmoderated: jest.fn().mockReturnValue(emptyListing),
};

const mockEmbeddingClient = {
  embed: jest.fn().mockResolvedValue([[0.1, 0.2]]),
};

describe('runQueueProcessor', () => {
  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    jest.clearAllMocks();
  });

  it('fetches queue, normalizes, embeds, and stores', async () => {
    await runQueueProcessor(
      'testsubreddit',
      mockKv as any,
      mockEmbeddingClient as any,
      mockReddit as any
    );

    expect(mockReddit.getModQueue).toHaveBeenCalledWith({ subreddit: 'testsubreddit', limit: 100 });
    expect(mockEmbeddingClient.embed).toHaveBeenCalledTimes(1);
    expect(mockKv.put).toHaveBeenCalledWith('mod_item_index', JSON.stringify(['p1']));
    expect(JSON.parse(store['mod_item:p1'])).toMatchObject({ id: 'p1', author: 'alice' });
    expect(JSON.parse(store['embedding:p1'])).toEqual([0.1, 0.2]);
  });
});

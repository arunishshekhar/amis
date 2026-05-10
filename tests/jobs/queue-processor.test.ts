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

const mockReddit = {
  currentSubreddit: jest.fn().mockResolvedValue({ name: 'testsubreddit' }),
  getModQueue: jest.fn().mockReturnValue({
    [Symbol.asyncIterator]: async function* () {
      yield { ...mockItem, type: 'post', authorName: 'alice', createdAt: new Date(1000), reports: [{ reason: 'spam' }] };
    },
  }),
};

const mockEmbeddingClient = {
  embed: jest.fn().mockResolvedValue({ data: [{ embedding: [0.1, 0.2] }] }),
};

describe('runQueueProcessor', () => {
  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    jest.clearAllMocks();
  });

  it('fetches queue, normalizes, embeds, and stores', async () => {
    await runQueueProcessor(
      mockReddit as any,
      mockKv as any,
      mockEmbeddingClient as any
    );

    expect(mockReddit.getModQueue).toHaveBeenCalledWith({ subredditName: 'testsubreddit', limit: 100 });
    expect(mockEmbeddingClient.embed).toHaveBeenCalledTimes(1);
    expect(mockKv.put).toHaveBeenCalledWith('mod_item:p1', expect.any(String));
    expect(mockKv.put).toHaveBeenCalledWith('embedding:p1', expect.any(String));
    expect(mockKv.put).toHaveBeenCalledWith('mod_item_index', JSON.stringify(['p1']));
  });
});

import { saveModItems, saveModItem, getAllModItemIds, getModItem } from '../../src/storage/mod-item-store';
import { KEYS } from '../../src/storage/keys';
import type { ModItem } from '../../src/types/mod-item';

const mockItem: ModItem = {
  id: 'item1',
  author: 'u1',
  timestamp: 1000,
  title: 'T',
  body: 'B',
  reportReasons: ['spam'],
  contentType: 'post',
  subredditId: 's1',
  editedAt: 0,
};

const makeKv = () => {
  const store: Record<string, string> = {};
  return {
    put: jest.fn(async (k: string, v: string) => { store[k] = v; }),
    get: jest.fn(async (k: string) => store[k] ?? undefined),
  };
};

describe('saveModItems', () => {
  it('persists each item and updates the index', async () => {
    const kv = makeKv();
    await saveModItems(kv as any, [mockItem]);
    expect(kv.put).toHaveBeenCalledWith(KEYS.modItem('item1'), JSON.stringify(mockItem));
    expect(kv.put).toHaveBeenCalledWith(KEYS.modItemIndex, JSON.stringify(['item1']));
  });
});

describe('saveModItem', () => {
  it('updates malformed indexes without throwing', async () => {
    const kv = makeKv();
    await kv.put(KEYS.modItemIndex, JSON.stringify({ id: 'old' }));
    await saveModItem(kv as any, mockItem);
    expect(await getAllModItemIds(kv as any)).toEqual(['item1']);
  });

  it('preserves legacy single-id indexes', async () => {
    const kv = makeKv();
    await kv.put(KEYS.modItemIndex, 'old');
    await saveModItem(kv as any, mockItem);
    expect(await getAllModItemIds(kv as any)).toEqual(['old', 'item1']);
  });
});

describe('getAllModItemIds', () => {
  it('returns empty array when index missing', async () => {
    const kv = makeKv();
    expect(await getAllModItemIds(kv as any)).toEqual([]);
  });

  it('returns empty array when index malformed', async () => {
    const kv = makeKv();
    await kv.put(KEYS.modItemIndex, JSON.stringify({ id: 'item1' }));
    expect(await getAllModItemIds(kv as any)).toEqual([]);
  });
});

describe('getModItem', () => {
  it('returns the stored item', async () => {
    const kv = makeKv();
    await saveModItems(kv as any, [mockItem]);
    const result = await getModItem(kv as any, 'item1');
    expect(result).toEqual(mockItem);
  });

  it('returns null for unknown id', async () => {
    const kv = makeKv();
    expect(await getModItem(kv as any, 'nope')).toBeNull();
  });
});

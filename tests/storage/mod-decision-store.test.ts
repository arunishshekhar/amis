import {
  saveDecision,
  getDecision,
  listDecisions,
  clearDecisions,
} from '../../src/storage/mod-decision-store';
import { KEYS } from '../../src/storage/keys';
import type { ModDecision } from '../../src/types/mod-decision';

const makeKv = () => {
  const store: Record<string, unknown> = {};
  return {
    put: jest.fn(async (k: string, v: unknown) => { store[k] = v; }),
    get: jest.fn(async (k: string) => store[k] ?? undefined),
    delete: jest.fn(async (k: string) => { delete store[k]; }),
  };
};

const sample: ModDecision = {
  targetId: 't3_abc123',
  action: 'removelink',
  moderator: 'mod1',
  timestamp: 1000000,
  subredditId: 'sub1',
};

describe('saveDecision / getDecision', () => {
  it('saves and retrieves a ModDecision', async () => {
    const kv = makeKv();
    await saveDecision(kv as any, sample);
    expect(kv.put).toHaveBeenCalledWith(KEYS.modDecision('t3_abc123'), JSON.stringify(sample));
    const result = await getDecision(kv as any, 't3_abc123');
    expect(result).toEqual(sample);
  });

  it('returns null for unknown targetId', async () => {
    const kv = makeKv();
    expect(await getDecision(kv as any, 't3_nope')).toBeNull();
  });
});

describe('listDecisions', () => {
  it('returns all saved decisions', async () => {
    const kv = makeKv();
    await saveDecision(kv as any, sample);
    await saveDecision(kv as any, { ...sample, targetId: 't3_xyz' });
    const list = await listDecisions(kv as any);
    expect(list).toHaveLength(2);
  });

  it('returns empty array when no decisions stored', async () => {
    const kv = makeKv();
    expect(await listDecisions(kv as any)).toEqual([]);
  });

  it('does not duplicate index entry when saving same targetId twice', async () => {
    const kv = makeKv();
    await saveDecision(kv as any, sample);
    await saveDecision(kv as any, { ...sample, action: 'approvelink' });
    const list = await listDecisions(kv as any);
    expect(list).toHaveLength(1);
    expect(list[0].action).toBe('approvelink');
  });
});

describe('clearDecisions', () => {
  it('removes all decisions and index', async () => {
    const kv = makeKv();
    await saveDecision(kv as any, sample);
    await clearDecisions(kv as any);
    expect(await listDecisions(kv as any)).toEqual([]);
    expect(await kv.get(KEYS.modDecisionIndex)).toBeUndefined();
  });

  it('no-ops when index is missing', async () => {
    const kv = makeKv();
    await expect(clearDecisions(kv as any)).resolves.toBeUndefined();
  });
});

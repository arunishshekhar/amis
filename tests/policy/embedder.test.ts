import { embedAndStorePolicies } from '../../src/policy/embedder';
import { KEYS } from '../../src/storage/keys';
import type { PolicyObject } from '../../src/types/policy-object';

const makeKv = () => {
  const store: Record<string, unknown> = {};
  return {
    put: jest.fn(async (k: string, v: unknown) => { store[k] = v; }),
    get: jest.fn(async (k: string) => store[k] ?? undefined),
  };
};

const policies: PolicyObject[] = [
  { id: 'rule:0', source: 'rule', title: 'No spam', text: 'No spam allowed', metadata: {} },
  { id: 'rule:1', source: 'rule', title: 'Be civil', text: 'Be nice', metadata: {} },
];

describe('embedAndStorePolicies', () => {
  it('embeds each policy with title: text format', async () => {
    const kv = makeKv();
    const mockEmbed = jest.fn()
      .mockResolvedValueOnce({ data: [{ embedding: [0.1, 0.2] }] })
      .mockResolvedValueOnce({ data: [{ embedding: [0.3, 0.4] }] });
    const client = { embed: mockEmbed } as any;

    await embedAndStorePolicies(kv as any, client, policies);

    expect(mockEmbed).toHaveBeenCalledWith({
      model: 'voyage-3',
      input: ['No spam: No spam allowed'],
    });
    expect(mockEmbed).toHaveBeenCalledWith({
      model: 'voyage-3',
      input: ['Be civil: Be nice'],
    });
  });

  it('stores each embedding vector under the correct key', async () => {
    const kv = makeKv();
    const mockEmbed = jest.fn()
      .mockResolvedValueOnce({ data: [{ embedding: [0.1, 0.2] }] })
      .mockResolvedValueOnce({ data: [{ embedding: [0.3, 0.4] }] });
    const client = { embed: mockEmbed } as any;

    await embedAndStorePolicies(kv as any, client, policies);

    expect(kv.put).toHaveBeenCalledWith(
      KEYS.policyEmbedding('rule:0'),
      JSON.stringify([0.1, 0.2])
    );
    expect(kv.put).toHaveBeenCalledWith(
      KEYS.policyEmbedding('rule:1'),
      JSON.stringify([0.3, 0.4])
    );
  });

  it('writes the policy index with all embedded ids', async () => {
    const kv = makeKv();
    const mockEmbed = jest.fn()
      .mockResolvedValueOnce({ data: [{ embedding: [0.1, 0.2] }] })
      .mockResolvedValueOnce({ data: [{ embedding: [0.3, 0.4] }] });
    const client = { embed: mockEmbed } as any;

    await embedAndStorePolicies(kv as any, client, policies);

    expect(kv.put).toHaveBeenCalledWith(
      KEYS.policyIndex,
      JSON.stringify(['rule:0', 'rule:1'])
    );
  });

  it('handles an empty policy list without error', async () => {
    const kv = makeKv();
    const client = { embed: jest.fn() } as any;
    await expect(embedAndStorePolicies(kv as any, client, [])).resolves.toBeUndefined();
    expect(kv.put).toHaveBeenCalledWith(KEYS.policyIndex, JSON.stringify([]));
  });
});

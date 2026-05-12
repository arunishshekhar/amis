import { VoyageEmbeddingClient, createEmbeddingClient } from '../../src/embeddings/client';

describe('VoyageEmbeddingClient', () => {
  it('embed calls Voyage AI and returns number[][]', async () => {
    const mockVoyageEmbed = jest.fn().mockResolvedValue({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
    });
    const client = new VoyageEmbeddingClient('test-key');
    // Inject mock into the private client
    (client as any).client = { embed: mockVoyageEmbed };

    const result = await client.embed(['hello world']);

    expect(mockVoyageEmbed).toHaveBeenCalledWith({
      model: 'voyage-3',
      input: ['hello world'],
    });
    expect(result).toEqual([[0.1, 0.2, 0.3]]);
  });

  it('createEmbeddingClient returns a VoyageEmbeddingClient', () => {
    const client = createEmbeddingClient('test-key');
    expect(client).toBeInstanceOf(VoyageEmbeddingClient);
  });
});

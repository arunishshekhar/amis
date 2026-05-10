import { createEmbeddingClient, embedText } from '../../src/embeddings/client';

describe('embedText', () => {
  it('calls Voyage AI and returns a float array', async () => {
    const mockEmbed = jest.fn().mockResolvedValue({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
    });
    const client = { embed: mockEmbed } as any;

    const result = await embedText(client, 'hello world');

    expect(mockEmbed).toHaveBeenCalledWith({
      model: 'voyage-3',
      input: ['hello world'],
    });
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });
});

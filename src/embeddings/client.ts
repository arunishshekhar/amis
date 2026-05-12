import { VoyageAIClient } from 'voyageai';
import type { EmbeddingClient } from '../ai/types';

export class VoyageEmbeddingClient implements EmbeddingClient {
  private client: VoyageAIClient;

  constructor(apiKey: string) {
    this.client = new VoyageAIClient({ apiKey });
  }

  async embed(texts: string[]): Promise<number[][]> {
    const result = await this.client.embed({ model: 'voyage-3', input: texts });
    if (!result.data) throw new Error('VoyageAI embed: response missing data field');
    return result.data.map((d) => {
      if (!d.embedding) throw new Error('VoyageAI embed: embedding missing in result item');
      return d.embedding;
    });
  }
}

export function createEmbeddingClient(apiKey: string): EmbeddingClient {
  return new VoyageEmbeddingClient(apiKey);
}

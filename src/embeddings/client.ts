import { VoyageAIClient } from 'voyageai';
import type { EmbeddingClient } from '../ai/types';

export class VoyageEmbeddingClient implements EmbeddingClient {
  private client: VoyageAIClient;

  constructor(apiKey: string) {
    this.client = new VoyageAIClient({ apiKey });
  }

  async embed(texts: string[]): Promise<number[][]> {
    const result = await this.client.embed({ model: 'voyage-3', input: texts });
    return result.data!.map((d) => d.embedding!);
  }
}

export function createEmbeddingClient(apiKey: string): VoyageEmbeddingClient {
  return new VoyageEmbeddingClient(apiKey);
}

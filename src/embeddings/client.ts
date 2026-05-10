import { VoyageAIClient } from 'voyageai';

export function createEmbeddingClient(apiKey: string): VoyageAIClient {
  return new VoyageAIClient({ apiKey });
}

export async function embedText(client: VoyageAIClient, text: string): Promise<number[]> {
  const result = await client.embed({ model: 'voyage-3', input: [text] });
  return result.data![0].embedding!;
}

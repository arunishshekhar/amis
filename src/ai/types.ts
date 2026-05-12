export interface EmbeddingClient {
  embed(texts: string[]): Promise<number[][]>;
}

export interface TextGenerationClient {
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}

export interface AIProvider {
  embedding: EmbeddingClient;
  textGen: TextGenerationClient;
}

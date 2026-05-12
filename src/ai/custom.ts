import type { TextGenerationClient, AIProvider } from './types';
import { VoyageEmbeddingClient } from '../embeddings/client';

class CustomTextGenClient implements TextGenerationClient {
  constructor(
    private apiKey: string,
    private baseUrl: string,
    private model: string
  ) {}

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 300,
      }),
    });
    if (!response.ok) throw new Error(`Custom AI API error: ${response.status} ${response.statusText}`);
    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0].message.content;
  }
}

export function createCustomProvider(
  apiKey: string,
  voyageApiKey: string,
  baseUrl: string,
  model: string
): AIProvider {
  return {
    embedding: new VoyageEmbeddingClient(voyageApiKey),
    textGen: new CustomTextGenClient(apiKey, baseUrl, model),
  };
}

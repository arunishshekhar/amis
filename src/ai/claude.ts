import type { TextGenerationClient, AIProvider } from './types';
import { VoyageEmbeddingClient } from '../embeddings/client';

class ClaudeTextGenClient implements TextGenerationClient {
  constructor(private apiKey: string) {}

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 200,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!response.ok) throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
    const data = await response.json() as { content: Array<{ text: string }> };
    return data.content[0].text;
  }
}

export function createClaudeProvider(anthropicApiKey: string, voyageApiKey: string): AIProvider {
  return {
    embedding: new VoyageEmbeddingClient(voyageApiKey),
    textGen: new ClaudeTextGenClient(anthropicApiKey),
  };
}

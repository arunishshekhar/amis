import type { EmbeddingClient, TextGenerationClient, AIProvider } from './types';

class OpenAIEmbeddingClient implements EmbeddingClient {
  constructor(private apiKey: string) {}

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`OpenAI Embed API error ${response.status} ${response.statusText}: ${body}`);
    }
    const data = await response.json() as { data: Array<{ embedding: number[] }> };
    return data.data.map((d) => d.embedding);
  }
}

class OpenAITextGenClient implements TextGenerationClient {
  constructor(private apiKey: string) {}

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 300,
      }),
    });
    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0].message.content;
  }
}

export function createOpenAIProvider(apiKey: string): AIProvider {
  return {
    embedding: new OpenAIEmbeddingClient(apiKey),
    textGen: new OpenAITextGenClient(apiKey),
  };
}

import type { EmbeddingClient, TextGenerationClient, AIProvider } from './types';

class GeminiEmbeddingClient implements EmbeddingClient {
  constructor(private apiKey: string) {}

  async embed(texts: string[]): Promise<number[][]> {
    return Promise.all(
      texts.map(async (text) => {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${this.apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: { parts: [{ text }] },
              // Pin to 768 dims for compatibility with existing stored vectors
              outputDimensionality: 768,
            }),
          }
        );
        if (!response.ok) throw new Error(`Gemini Embed API error: ${response.status} ${response.statusText}`);
        const data = await response.json() as { embedding: { values: number[] } };
        return data.embedding.values;
      })
    );
  }
}

class GeminiTextGenClient implements TextGenerationClient {
  constructor(private apiKey: string) {}

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { maxOutputTokens: 200 },
        }),
      }
    );
    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Gemini GenerateContent API error: ${response.status} ${response.statusText}: ${errBody}`);
    }
    const data = await response.json() as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    return data.candidates[0].content.parts[0].text;
  }
}

export function createGeminiProvider(apiKey: string): AIProvider {
  return {
    embedding: new GeminiEmbeddingClient(apiKey),
    textGen: new GeminiTextGenClient(apiKey),
  };
}

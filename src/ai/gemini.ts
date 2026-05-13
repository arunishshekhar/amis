import type { EmbeddingClient, TextGenerationClient, AIProvider } from './types';

class GeminiEmbeddingClient implements EmbeddingClient {
  constructor(private apiKey: string) {}

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: { parts: [{ text: texts[i] }] },
            // Pin to 768 dims for compatibility with existing stored vectors
            outputDimensionality: 768,
          }),
        }
      );
      if (!response.ok) throw new Error(`Gemini Embed API error: ${response.status} ${response.statusText}`);
      const data = await response.json() as { embedding: { values: number[] } };
      results.push(data.embedding.values);
      // 1-second gap between embed calls to stay within Devvit's HTTP rate limit
      if (i < texts.length - 1) await new Promise((r) => setTimeout(r, 1000));
    }
    return results;
  }
}

class GeminiTextGenClient implements TextGenerationClient {
  constructor(private apiKey: string) {}

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`,
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

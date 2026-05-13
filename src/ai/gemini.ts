import type { EmbeddingClient, TextGenerationClient, AIProvider } from './types';

/** Sleep for `ms` milliseconds. */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Fetch wrapper with exponential-backoff retry for 429 / 503 responses.
 * Devvit's HTTP layer enforces a per-execution request budget; if we exceed it
 * the platform throws a gRPC UNKNOWN "too many requests" error.  By backing
 * off and retrying we stay well within that budget.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 4
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, init);
      // Retry on 429 (rate-limited) or 503 (service unavailable)
      if (response.status === 429 || response.status === 503) {
        const retryAfterHeader = response.headers.get('Retry-After');
        const waitMs = retryAfterHeader
          ? parseInt(retryAfterHeader, 10) * 1000
          : Math.min(2000 * 2 ** attempt, 30_000); // 2s, 4s, 8s, 16s, 30s cap
        console.warn(`Gemini API rate-limited (${response.status}), retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`);
        await sleep(waitMs);
        continue;
      }
      return response;
    } catch (err) {
      // Platform-level gRPC "too many requests" — treat the same as 429
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('too many requests') || msg.includes('RESOURCE_EXHAUSTED')) {
        const waitMs = Math.min(3000 * 2 ** attempt, 30_000);
        console.warn(`Gemini gRPC rate-limit hit, retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`);
        await sleep(waitMs);
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error('Gemini fetchWithRetry: max retries exceeded');
}

class GeminiEmbeddingClient implements EmbeddingClient {
  constructor(private apiKey: string) {}

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      const response = await fetchWithRetry(
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
      // 2-second gap between embed calls to stay within Devvit's HTTP rate limit
      if (i < texts.length - 1) await sleep(2000);
    }
    return results;
  }
}

class GeminiTextGenClient implements TextGenerationClient {
  constructor(private apiKey: string) {}

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { maxOutputTokens: 400 },
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

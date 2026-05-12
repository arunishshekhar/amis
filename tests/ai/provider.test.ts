import { createAIProvider } from '../../src/ai/provider';

const makeSettings = (values: Record<string, string>) => ({
  get: jest.fn(async <T>(key: string): Promise<T | undefined> => values[key] as unknown as T),
});

describe('createAIProvider', () => {
  it('returns provider with embedding and textGen for openai', async () => {
    const settings = makeSettings({ AI_PROVIDER: 'openai', AI_API_KEY: 'sk-test' });
    const provider = await createAIProvider(settings);
    expect(typeof provider.embedding.embed).toBe('function');
    expect(typeof provider.textGen.complete).toBe('function');
  });

  it('prefers KV-backed configuration over app settings when present', async () => {
    const settings = makeSettings({ AI_PROVIDER: 'openai', AI_API_KEY: 'sk-test' });
    const kvStore = {
      get: jest.fn(async (key: string) => {
        if (key === 'ai_config') {
          return JSON.stringify({ provider: 'gemini', apiKey: 'gem-test' });
        }
        return undefined;
      }),
    };

    const provider = await createAIProvider(settings, kvStore as any);
    expect(typeof provider.embedding.embed).toBe('function');
    expect(typeof provider.textGen.complete).toBe('function');
  });

  it('returns provider with embedding and textGen for gemini', async () => {
    const settings = makeSettings({ AI_PROVIDER: 'gemini', AI_API_KEY: 'gem-test' });
    const provider = await createAIProvider(settings);
    expect(typeof provider.embedding.embed).toBe('function');
    expect(typeof provider.textGen.complete).toBe('function');
  });

  it('returns provider with embedding and textGen for claude', async () => {
    const settings = makeSettings({
      AI_PROVIDER: 'claude',
      AI_API_KEY: 'ant-test',
      VOYAGE_API_KEY: 'voyage-test',
    });
    const provider = await createAIProvider(settings);
    expect(typeof provider.embedding.embed).toBe('function');
    expect(typeof provider.textGen.complete).toBe('function');
  });

  it('returns provider with embedding and textGen for custom', async () => {
    const settings = makeSettings({
      AI_PROVIDER: 'custom',
      AI_API_KEY: 'key',
      VOYAGE_API_KEY: 'voyage-key',
      CUSTOM_API_BASE_URL: 'http://localhost:11434/v1',
      CUSTOM_MODEL: 'llama3',
    });
    const provider = await createAIProvider(settings);
    expect(typeof provider.embedding.embed).toBe('function');
    expect(typeof provider.textGen.complete).toBe('function');
  });

  it('defaults to claude when AI_PROVIDER is not set', async () => {
    const settings = makeSettings({ AI_API_KEY: 'ant-test', VOYAGE_API_KEY: 'voyage-test' });
    const provider = await createAIProvider(settings);
    expect(typeof provider.textGen.complete).toBe('function');
  });

  it('throws when AI_API_KEY is missing', async () => {
    const settings = makeSettings({ AI_PROVIDER: 'openai' });
    await expect(createAIProvider(settings)).rejects.toThrow('AI_API_KEY is not set');
  });

  it('throws when VOYAGE_API_KEY is missing for claude', async () => {
    const settings = makeSettings({ AI_PROVIDER: 'claude', AI_API_KEY: 'ant-test' });
    await expect(createAIProvider(settings)).rejects.toThrow('VOYAGE_API_KEY');
  });

  it('throws when CUSTOM_API_BASE_URL is missing for custom', async () => {
    const settings = makeSettings({
      AI_PROVIDER: 'custom',
      AI_API_KEY: 'key',
      VOYAGE_API_KEY: 'voy',
      CUSTOM_MODEL: 'llama3',
    });
    await expect(createAIProvider(settings)).rejects.toThrow('CUSTOM_API_BASE_URL');
  });

  it('throws when CUSTOM_MODEL is missing for custom', async () => {
    const settings = makeSettings({
      AI_PROVIDER: 'custom',
      AI_API_KEY: 'key',
      VOYAGE_API_KEY: 'voy',
      CUSTOM_API_BASE_URL: 'http://localhost:11434/v1',
    });
    await expect(createAIProvider(settings)).rejects.toThrow('CUSTOM_MODEL');
  });
});

import type { AIProvider } from './types';
import { createOpenAIProvider } from './openai';
import { createClaudeProvider } from './claude';
import { createGeminiProvider } from './gemini';
import { createCustomProvider } from './custom';

interface Settings {
  get(key: string): Promise<unknown>;
}

export async function createAIProvider(settings: Settings): Promise<AIProvider> {
  const providerName = (await settings.get('AI_PROVIDER')) as string | undefined ?? 'claude';
  const aiKey = (await settings.get('AI_API_KEY')) as string | undefined;
  if (!aiKey) throw new Error('createAIProvider: AI_API_KEY is not set');

  if (providerName === 'openai') {
    return createOpenAIProvider(aiKey);
  }
  if (providerName === 'gemini') {
    return createGeminiProvider(aiKey);
  }

  const voyageKey = (await settings.get('VOYAGE_API_KEY')) as string | undefined;
  if (!voyageKey) {
    throw new Error(`createAIProvider: VOYAGE_API_KEY is required for ${providerName} provider`);
  }

  if (providerName === 'claude') {
    return createClaudeProvider(aiKey, voyageKey);
  }

  // custom
  const baseUrl = (await settings.get('CUSTOM_API_BASE_URL')) as string | undefined;
  if (!baseUrl) throw new Error('createAIProvider: CUSTOM_API_BASE_URL is required for custom provider');
  const model = (await settings.get('CUSTOM_MODEL')) as string | undefined;
  if (!model) throw new Error('createAIProvider: CUSTOM_MODEL is required for custom provider');

  return createCustomProvider(aiKey, voyageKey, baseUrl, model);
}

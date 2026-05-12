import type { AIProvider } from './types';
import { createOpenAIProvider } from './openai';
import { createClaudeProvider } from './claude';
import { createGeminiProvider } from './gemini';
import { createCustomProvider } from './custom';
import type { KVStore } from '@devvit/public-api';
import { getAIConfig } from '../storage/ai-config-store';

interface Settings {
  get(key: string): Promise<unknown>;
}

export async function createAIProvider(settings: Settings, kvStore?: KVStore): Promise<AIProvider> {
  const aiConfig = kvStore ? await getAIConfig(kvStore) : null;
  const providerName = aiConfig?.provider ?? ((await settings.get('AI_PROVIDER')) as string | undefined) ?? 'claude';
  const aiKey = aiConfig?.apiKey ?? (await settings.get('AI_API_KEY')) as string | undefined;
  if (!aiKey) throw new Error('createAIProvider: AI_API_KEY is not set');

  if (providerName === 'openai') {
    return createOpenAIProvider(aiKey);
  }
  if (providerName === 'gemini') {
    return createGeminiProvider(aiKey);
  }

  const voyageKey = aiConfig?.voyageApiKey ?? (await settings.get('VOYAGE_API_KEY')) as string | undefined;
  if (!voyageKey) {
    throw new Error(`createAIProvider: VOYAGE_API_KEY is required for ${providerName} provider`);
  }

  if (providerName === 'claude') {
    return createClaudeProvider(aiKey, voyageKey);
  }

  // custom
  const baseUrl = aiConfig?.customApiBaseUrl ?? (await settings.get('CUSTOM_API_BASE_URL')) as string | undefined;
  if (!baseUrl) throw new Error('createAIProvider: CUSTOM_API_BASE_URL is required for custom provider');
  const model = aiConfig?.customModel ?? (await settings.get('CUSTOM_MODEL')) as string | undefined;
  if (!model) throw new Error('createAIProvider: CUSTOM_MODEL is required for custom provider');

  return createCustomProvider(aiKey, voyageKey, baseUrl, model);
}

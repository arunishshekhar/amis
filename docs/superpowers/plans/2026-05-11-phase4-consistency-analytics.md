# Phase 4 — Consistency Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a configurable AI provider abstraction (OpenAI / Claude / Gemini / Custom) and a Consistency Analytics Engine that detects divergent moderation outcomes, surfaces rule drift, and generates AI-powered plain-language insights from the Reddit mod log.

**Architecture:** An `AIProvider` interface unifies embedding and text generation behind a factory that reads Devvit settings. The existing Voyage AI embedding client is wrapped to satisfy the interface. The consistency engine fetches the Reddit mod log, stores decisions in KV, runs three pure-function detectors, and calls the text generation client to produce `ConsistencyInsight` records.

**Tech Stack:** TypeScript, Devvit KV Store, Devvit `@devvit/public-api`, Voyage AI SDK (existing, as fallback embedding for Claude/Custom), OpenAI REST API, Anthropic Messages REST API, Google Generative Language REST API — all network calls use `fetch` (Devvit's `http: true` grants access).

---

## File Map

### New files
```
src/ai/types.ts                              — EmbeddingClient, TextGenerationClient, AIProvider interfaces
src/ai/openai.ts                             — OpenAI embedding + text gen implementation
src/ai/claude.ts                             — Voyage embedding + Claude text gen implementation
src/ai/gemini.ts                             — Gemini embedding + text gen implementation
src/ai/custom.ts                             — Voyage embedding + custom OpenAI-compatible text gen
src/ai/provider.ts                           — createAIProvider factory
src/types/mod-decision.ts                    — ModDecision, ModAction types
src/types/consistency-insight.ts             — ConsistencyInsight, InsightType types
src/storage/mod-decision-store.ts            — saveDecision, getDecision, listDecisions, clearDecisions
src/storage/insight-store.ts                 — saveInsight, getInsight, listInsights, acknowledgeInsight, clearInsights
src/consistency/mod-log-fetcher.ts           — fetchModLog (wraps reddit.getModerationLog)
src/consistency/divergence-detector.ts       — detectDivergence, detectDrift, calculateVariance (pure fns)
src/consistency/insight-generator.ts         — generateInsight (calls provider.textGen.complete)
src/consistency/engine.ts                    — runConsistencyEngine, ConsistencySummary
tests/ai/provider.test.ts
tests/storage/mod-decision-store.test.ts
tests/storage/insight-store.test.ts
tests/consistency/divergence-detector.test.ts
tests/consistency/insight-generator.test.ts
tests/consistency/engine.test.ts
```

### Modified files
```
src/ai/types.ts           (new — defines EmbeddingClient used by next 4 files)
src/embeddings/client.ts  — export VoyageEmbeddingClient class satisfying EmbeddingClient; keep createEmbeddingClient for backward compat
src/embeddings/generator.ts — change VoyageAIClient param → EmbeddingClient; call client.embed([text])[0]
src/policy/embedder.ts    — change VoyageAIClient param → EmbeddingClient; call client.embed([text])[0]
src/jobs/queue-processor.ts — change VoyageAIClient param type → EmbeddingClient
src/triggers/policy-refresh.ts — change VoyageAIClient param type → EmbeddingClient
src/storage/keys.ts       — add modDecision, modDecisionIndex, insight, insightIndex
src/main.ts               — add 4 settings; replace createEmbeddingClient with createAIProvider; add job + menu item
src/triggers/health-check.ts — append pending insight count to toast
```

---

## Task 1: AI interfaces + refactor embedding type signatures

**Files:**
- Create: `src/ai/types.ts`
- Modify: `src/embeddings/client.ts`
- Modify: `src/embeddings/generator.ts`
- Modify: `src/policy/embedder.ts`
- Modify: `src/jobs/queue-processor.ts`
- Modify: `src/triggers/policy-refresh.ts`

This task has no new tests — all existing tests must continue to pass after the type-level refactor.

- [ ] **Step 1: Create `src/ai/types.ts`**

```typescript
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
```

- [ ] **Step 2: Update `src/embeddings/client.ts`**

Replace the entire file contents with:

```typescript
import { VoyageAIClient } from 'voyageai';
import type { EmbeddingClient } from '../ai/types';

export class VoyageEmbeddingClient implements EmbeddingClient {
  private client: VoyageAIClient;

  constructor(apiKey: string) {
    this.client = new VoyageAIClient({ apiKey });
  }

  async embed(texts: string[]): Promise<number[][]> {
    const result = await this.client.embed({ model: 'voyage-3', input: texts });
    return result.data!.map((d) => d.embedding!);
  }
}

export function createEmbeddingClient(apiKey: string): VoyageEmbeddingClient {
  return new VoyageEmbeddingClient(apiKey);
}
```

- [ ] **Step 3: Update `src/embeddings/generator.ts`**

Replace the entire file contents with:

```typescript
import type { KVStore } from '@devvit/public-api';
import type { EmbeddingClient } from '../ai/types';
import type { ModItem } from '../types/mod-item';
import { saveEmbedding } from '../storage/embedding-store';

function itemToEmbedInput(item: ModItem): string {
  const parts = [item.title, item.body, ...item.reportReasons].filter(Boolean);
  return parts.join(' | ');
}

export async function generateAndStoreEmbeddings(
  kv: KVStore,
  client: EmbeddingClient,
  items: ModItem[]
): Promise<void> {
  await Promise.all(
    items.map(async (item) => {
      const text = itemToEmbedInput(item);
      const [vector] = await client.embed([text]);
      await saveEmbedding(kv, item.id, vector);
    })
  );
}
```

- [ ] **Step 4: Update `src/policy/embedder.ts`**

Replace the entire file contents with:

```typescript
import type { KVStore } from '@devvit/public-api';
import type { EmbeddingClient } from '../ai/types';
import type { PolicyObject } from '../types/policy-object';
import { KEYS } from '../storage/keys';

export async function embedAndStorePolicies(
  kv: KVStore,
  client: EmbeddingClient,
  policies: PolicyObject[]
): Promise<void> {
  await Promise.all(
    policies.map(async (policy) => {
      const text = `${policy.title}: ${policy.text}`;
      const [vector] = await client.embed([text]);
      await kv.put(KEYS.policyEmbedding(policy.id), JSON.stringify(vector));
    })
  );
  await kv.put(KEYS.policyIndex, JSON.stringify(policies.map((p) => p.id)));
}
```

- [ ] **Step 5: Update `src/jobs/queue-processor.ts` — change parameter type**

Change the import and parameter type (logic is unchanged):

```typescript
import type { KVStore } from '@devvit/public-api';
import type { EmbeddingClient } from '../ai/types';
import { fetchModQueue } from '../queue/fetcher';
import { saveModItems } from '../storage/mod-item-store';
import { generateAndStoreEmbeddings } from '../embeddings/generator';

export async function runQueueProcessor(
  subredditName: string,
  kv: KVStore,
  embeddingClient: EmbeddingClient,
  reddit: any
): Promise<void> {
  try {
    const items = await fetchModQueue(reddit, subredditName);
    await saveModItems(kv, items);
    await generateAndStoreEmbeddings(kv, embeddingClient, items);
  } catch (err) {
    console.error('runQueueProcessor failed:', err);
    throw err;
  }
}
```

- [ ] **Step 6: Update `src/triggers/policy-refresh.ts` — change parameter type**

Change only the import and parameter type; the function body is unchanged:

```typescript
import type { KVStore, RedditAPIClient } from '@devvit/public-api';
import { Devvit } from '@devvit/public-api';
import type { Metadata } from '@devvit/protos';
import type { EmbeddingClient } from '../ai/types';
import { ingestRules } from '../policy/rule-ingestor';
import { parseAutomodConfig } from '../policy/automod-parser';
import { ingestWikiPages } from '../policy/wiki-ingestor';
import { ingestRemovalReasons } from '../policy/removal-reason-ingestor';
import { embedAndStorePolicies } from '../policy/embedder';
import { savePolicy, clearPolicies } from '../storage/policy-store';

export interface PolicyRefreshResult {
  rulesCount: number;
  automodCount: number;
  wikiCount: number;
  removalCount: number;
}

export async function runPolicyRefresh(
  subredditName: string,
  kv: KVStore,
  embeddingClient: EmbeddingClient,
  reddit: RedditAPIClient,
  metadata: Metadata,
  wikiPages: string[]
): Promise<PolicyRefreshResult> {
  const getRules = async (name: string) => {
    const rsp = await (Devvit as any).redditAPIPlugins.Subreddits.SubredditAboutRules(
      { subreddit: name },
      metadata
    );
    return rsp.rules ?? [];
  };

  const [rules, automod, wiki, removal] = await Promise.all([
    ingestRules(subredditName, getRules),
    parseAutomodConfig(reddit, subredditName),
    ingestWikiPages(reddit, subredditName, wikiPages),
    ingestRemovalReasons(reddit, subredditName),
  ]);

  await clearPolicies(kv);

  const all = [...rules, ...automod, ...wiki, ...removal];
  await Promise.all(all.map((p) => savePolicy(kv, p)));
  await embedAndStorePolicies(kv, embeddingClient, all);

  return {
    rulesCount: rules.length,
    automodCount: automod.length,
    wikiCount: wiki.length,
    removalCount: removal.length,
  };
}
```

- [ ] **Step 7: Run full test suite to confirm no regressions**

```bash
npm test
```

Expected: all existing tests pass (the type changes are compatible — `VoyageEmbeddingClient` implements `EmbeddingClient`).

- [ ] **Step 8: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/ai/types.ts src/embeddings/client.ts src/embeddings/generator.ts \
  src/policy/embedder.ts src/jobs/queue-processor.ts src/triggers/policy-refresh.ts
git commit -m "refactor: introduce EmbeddingClient interface; wrap VoyageAI to satisfy it"
```

---

## Task 2: OpenAI provider

**Files:**
- Create: `src/ai/openai.ts`

- [ ] **Step 1: Create `src/ai/openai.ts`**

```typescript
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
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ai/openai.ts
git commit -m "feat: add OpenAI provider (text-embedding-3-small + gpt-4o-mini)"
```

---

## Task 3: Claude provider

**Files:**
- Create: `src/ai/claude.ts`

- [ ] **Step 1: Create `src/ai/claude.ts`**

```typescript
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
        model: 'claude-haiku-4-5',
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    const data = await response.json() as {
      content: Array<{ text: string }>;
    };
    return data.content[0].text;
  }
}

export function createClaudeProvider(anthropicApiKey: string, voyageApiKey: string): AIProvider {
  return {
    embedding: new VoyageEmbeddingClient(voyageApiKey),
    textGen: new ClaudeTextGenClient(anthropicApiKey),
  };
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ai/claude.ts
git commit -m "feat: add Claude provider (Voyage embeddings + claude-haiku-4-5 text gen)"
```

---

## Task 4: Gemini provider

**Files:**
- Create: `src/ai/gemini.ts`

- [ ] **Step 1: Create `src/ai/gemini.ts`**

```typescript
import type { EmbeddingClient, TextGenerationClient, AIProvider } from './types';

class GeminiEmbeddingClient implements EmbeddingClient {
  constructor(private apiKey: string) {}

  async embed(texts: string[]): Promise<number[][]> {
    return Promise.all(
      texts.map(async (text) => {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${this.apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'models/text-embedding-004',
              content: { parts: [{ text }] },
            }),
          }
        );
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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { maxOutputTokens: 300 },
        }),
      }
    );
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
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ai/gemini.ts
git commit -m "feat: add Gemini provider (text-embedding-004 + gemini-2.0-flash)"
```

---

## Task 5: Custom provider

**Files:**
- Create: `src/ai/custom.ts`

- [ ] **Step 1: Create `src/ai/custom.ts`**

```typescript
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
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ai/custom.ts
git commit -m "feat: add Custom provider (Voyage embeddings + OpenAI-compatible text gen)"
```

---

## Task 6: Provider factory + tests

**Files:**
- Create: `src/ai/provider.ts`
- Create: `tests/ai/provider.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ai/provider.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/ai/provider.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '../../src/ai/provider'`

- [ ] **Step 3: Create `src/ai/provider.ts`**

```typescript
import type { AIProvider } from './types';
import { createOpenAIProvider } from './openai';
import { createClaudeProvider } from './claude';
import { createGeminiProvider } from './gemini';
import { createCustomProvider } from './custom';

interface Settings {
  get<T>(key: string): Promise<T | undefined>;
}

export async function createAIProvider(settings: Settings): Promise<AIProvider> {
  const providerName = (await settings.get<string>('AI_PROVIDER')) ?? 'claude';
  const aiKey = await settings.get<string>('AI_API_KEY');
  if (!aiKey) throw new Error('createAIProvider: AI_API_KEY is not set');

  if (providerName === 'openai') {
    return createOpenAIProvider(aiKey);
  }
  if (providerName === 'gemini') {
    return createGeminiProvider(aiKey);
  }

  const voyageKey = await settings.get<string>('VOYAGE_API_KEY');
  if (!voyageKey) {
    throw new Error(`createAIProvider: VOYAGE_API_KEY is required for ${providerName} provider`);
  }

  if (providerName === 'claude') {
    return createClaudeProvider(aiKey, voyageKey);
  }

  // custom
  const baseUrl = await settings.get<string>('CUSTOM_API_BASE_URL');
  if (!baseUrl) throw new Error('createAIProvider: CUSTOM_API_BASE_URL is required for custom provider');
  const model = await settings.get<string>('CUSTOM_MODEL');
  if (!model) throw new Error('createAIProvider: CUSTOM_MODEL is required for custom provider');

  return createCustomProvider(aiKey, voyageKey, baseUrl, model);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/ai/provider.test.ts --no-coverage
```

Expected: PASS — 9 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/ai/provider.ts tests/ai/provider.test.ts
git commit -m "feat: add createAIProvider factory with tests for all four provider types"
```

---

## Task 7: Update main.ts to use provider factory

**Files:**
- Modify: `src/main.ts`

No new tests — this is a wiring task. The existing scheduler jobs continue to work; they now get their embedding client from `createAIProvider` instead of directly from `createEmbeddingClient`.

- [ ] **Step 1: Add new settings and update all scheduler jobs in `src/main.ts`**

Replace the entire file with:

```typescript
import { Devvit } from '@devvit/public-api';
import { createAIProvider } from './ai/provider';
import { runQueueProcessor } from './jobs/queue-processor';
import { runHealthCheck } from './triggers/health-check';
import { runPolicyRefresh } from './triggers/policy-refresh';
import { runRecommendationEngine } from './recommendations/engine';

Devvit.configure({
  kvStore: true,
  redditAPI: true,
  http: true,
});

Devvit.addSettings([
  {
    name: 'VOYAGE_API_KEY',
    label: 'Voyage AI API Key (required when AI Provider is Claude or Custom)',
    type: 'string',
    isSecret: true,
    scope: 'app',
  },
  {
    name: 'WIKI_PAGES',
    label: 'Wiki pages to ingest (comma-separated)',
    type: 'string',
    isSecret: false,
    scope: 'app',
  },
  {
    name: 'AI_PROVIDER',
    label: 'AI Provider (openai | claude | gemini | custom) — defaults to claude',
    type: 'string',
    isSecret: false,
    scope: 'app',
  },
  {
    name: 'AI_API_KEY',
    label: 'AI Provider API Key',
    type: 'string',
    isSecret: true,
    scope: 'app',
  },
  {
    name: 'CUSTOM_API_BASE_URL',
    label: 'Custom AI Base URL (e.g. http://localhost:11434/v1) — only for custom provider',
    type: 'string',
    isSecret: false,
    scope: 'app',
  },
  {
    name: 'CUSTOM_MODEL',
    label: 'Custom AI Model name — only for custom provider',
    type: 'string',
    isSecret: false,
    scope: 'app',
  },
]);

Devvit.addTrigger({
  event: 'AppInstall',
  async onEvent(_event, context) {
    await context.scheduler.runJob({
      name: 'queue-processor',
      cron: '0 */6 * * *',
    });
    await context.scheduler.runJob({
      name: 'policy-refresh',
      runAt: new Date(),
    });
    await context.scheduler.runJob({
      name: 'recommendation-run',
      runAt: new Date(Date.now() + 5000),
    });
    await context.scheduler.runJob({
      name: 'consistency-analysis',
      runAt: new Date(Date.now() + 15000),
    });
    await context.scheduler.runJob({
      name: 'consistency-analysis',
      cron: '0 2 * * *',
    });
  },
});

Devvit.addSchedulerJob({
  name: 'queue-processor',
  onRun: async (_event, context) => {
    if (!context.subredditName) {
      console.error('queue-processor: subredditName unavailable — skipping');
      return;
    }
    const provider = await createAIProvider(context.settings);
    await runQueueProcessor(context.subredditName, context.kvStore, provider.embedding, context.reddit);
  },
});

Devvit.addSchedulerJob({
  name: 'policy-refresh',
  onRun: async (_event, context) => {
    if (!context.subredditName) {
      console.error('policy-refresh: subredditName unavailable — skipping');
      return;
    }
    const wikiPagesRaw = (await context.settings.get<string>('WIKI_PAGES')) ?? '';
    const wikiPages = wikiPagesRaw.split(',').map((p) => p.trim()).filter(Boolean);
    const provider = await createAIProvider(context.settings);
    const result = await runPolicyRefresh(
      context.subredditName,
      context.kvStore,
      provider.embedding,
      context.reddit,
      context.debug.metadata,
      wikiPages
    );
    console.log(
      `policy-refresh complete: ${result.rulesCount} rules, ` +
        `${result.automodCount} automod, ${result.wikiCount} wiki, ` +
        `${result.removalCount} removal reasons`
    );
  },
});

Devvit.addSchedulerJob({
  name: 'recommendation-run',
  onRun: async (_event, context) => {
    if (!context.subredditName) {
      console.error('recommendation-run: subredditName unavailable — skipping');
      return;
    }
    const summary = await runRecommendationEngine(context.kvStore);
    console.log(
      `recommendation-run complete: ${summary.processed} processed, ` +
        `${summary.removed} remove, ${summary.monitored} monitor, ` +
        `${summary.approved} approve, ${summary.escalated} escalate`
    );
  },
});

Devvit.addSchedulerJob({
  name: 'consistency-analysis',
  onRun: async (_event, context) => {
    if (!context.subredditName) {
      console.error('consistency-analysis: subredditName unavailable — skipping');
      return;
    }
    // Imported in Task 14 once engine exists
    const { runConsistencyEngine } = await import('./consistency/engine');
    const provider = await createAIProvider(context.settings);
    const summary = await runConsistencyEngine(
      context.kvStore,
      provider,
      context.reddit,
      context.subredditName
    );
    console.log(`consistency-analysis: ${summary.insightsGenerated} insights generated`);
  },
});

Devvit.addMenuItem({
  label: 'AMIS: Health Check',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    await runHealthCheck(context.kvStore, context.ui);
  },
});

Devvit.addMenuItem({
  label: 'AMIS: Refresh Policy',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    if (!context.subredditName) {
      context.ui.showToast('AMIS: subreddit name unavailable');
      return;
    }
    const wikiPagesRaw = (await context.settings.get<string>('WIKI_PAGES')) ?? '';
    const wikiPages = wikiPagesRaw.split(',').map((p) => p.trim()).filter(Boolean);
    const provider = await createAIProvider(context.settings);
    const result = await runPolicyRefresh(
      context.subredditName,
      context.kvStore,
      provider.embedding,
      context.reddit,
      context.debug.metadata,
      wikiPages
    );
    context.ui.showToast(
      `Policy refreshed: ${result.rulesCount} rules, ` +
        `${result.automodCount} automod patterns, ` +
        `${result.wikiCount} wiki chunks, ` +
        `${result.removalCount} removal reasons`
    );
  },
});

Devvit.addMenuItem({
  label: 'AMIS: Analyze Queue',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    const summary = await runRecommendationEngine(context.kvStore);
    context.ui.showToast(
      `Analysis: ${summary.removed} remove, ${summary.monitored} monitor, ` +
        `${summary.approved} approve, ${summary.escalated} escalate`
    );
  },
});

Devvit.addMenuItem({
  label: 'AMIS: Consistency Check',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    if (!context.subredditName) {
      context.ui.showToast('AMIS: subreddit name unavailable');
      return;
    }
    // Imported in Task 14 once engine exists
    const { runConsistencyEngine } = await import('./consistency/engine');
    const provider = await createAIProvider(context.settings);
    const summary = await runConsistencyEngine(
      context.kvStore,
      provider,
      context.reddit,
      context.subredditName
    );
    if (summary.skipped) {
      context.ui.showToast(
        `Consistency: not enough data (${summary.decisionCount}/50 decisions)`
      );
    } else {
      context.ui.showToast(
        `Consistency: ${summary.insightsGenerated} new insights generated`
      );
    }
  },
});

export default Devvit;
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. (The dynamic `import('./consistency/engine')` is valid TS — the module will exist after Task 13.)

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire createAIProvider into main.ts; add 4 new settings; stub consistency-analysis job"
```

---

## Task 8: Storage keys + ModDecision type + store + tests

**Files:**
- Modify: `src/storage/keys.ts`
- Create: `src/types/mod-decision.ts`
- Create: `src/storage/mod-decision-store.ts`
- Create: `tests/storage/mod-decision-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/storage/mod-decision-store.test.ts`:

```typescript
import {
  saveDecision,
  getDecision,
  listDecisions,
  clearDecisions,
} from '../../src/storage/mod-decision-store';
import { KEYS } from '../../src/storage/keys';
import type { ModDecision } from '../../src/types/mod-decision';

const makeKv = () => {
  const store: Record<string, unknown> = {};
  return {
    put: jest.fn(async (k: string, v: unknown) => { store[k] = v; }),
    get: jest.fn(async (k: string) => store[k] ?? undefined),
    delete: jest.fn(async (k: string) => { delete store[k]; }),
  };
};

const sample: ModDecision = {
  targetId: 't3_abc123',
  action: 'removelink',
  moderator: 'mod1',
  timestamp: 1000000,
  subredditId: 'sub1',
};

describe('saveDecision / getDecision', () => {
  it('saves and retrieves a ModDecision', async () => {
    const kv = makeKv();
    await saveDecision(kv as any, sample);
    expect(kv.put).toHaveBeenCalledWith(KEYS.modDecision('t3_abc123'), JSON.stringify(sample));
    const result = await getDecision(kv as any, 't3_abc123');
    expect(result).toEqual(sample);
  });

  it('returns null for unknown targetId', async () => {
    const kv = makeKv();
    expect(await getDecision(kv as any, 't3_nope')).toBeNull();
  });
});

describe('listDecisions', () => {
  it('returns all saved decisions', async () => {
    const kv = makeKv();
    await saveDecision(kv as any, sample);
    await saveDecision(kv as any, { ...sample, targetId: 't3_xyz' });
    const list = await listDecisions(kv as any);
    expect(list).toHaveLength(2);
  });

  it('returns empty array when no decisions stored', async () => {
    const kv = makeKv();
    expect(await listDecisions(kv as any)).toEqual([]);
  });

  it('does not duplicate index entry when saving same targetId twice', async () => {
    const kv = makeKv();
    await saveDecision(kv as any, sample);
    await saveDecision(kv as any, { ...sample, action: 'approvelink' });
    const list = await listDecisions(kv as any);
    expect(list).toHaveLength(1);
    expect(list[0].action).toBe('approvelink');
  });
});

describe('clearDecisions', () => {
  it('removes all decisions and index', async () => {
    const kv = makeKv();
    await saveDecision(kv as any, sample);
    await clearDecisions(kv as any);
    expect(await listDecisions(kv as any)).toEqual([]);
    expect(await kv.get(KEYS.modDecisionIndex)).toBeUndefined();
  });

  it('no-ops when index is missing', async () => {
    const kv = makeKv();
    await expect(clearDecisions(kv as any)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/storage/mod-decision-store.test.ts --no-coverage
```

Expected: FAIL — module not found errors.

- [ ] **Step 3: Add keys to `src/storage/keys.ts`**

```typescript
export const KEYS = {
  modItem: (id: string) => `mod_item:${id}`,
  embedding: (id: string) => `embedding:${id}`,
  modItemIndex: 'mod_item_index',
  policy: (id: string) => `policy:${id}`,
  policyIndex: 'policy_index',
  policyEmbedding: (id: string) => `policy_embedding:${id}`,
  recommendation: (id: string) => `recommendation:${id}`,
  recommendationIndex: 'recommendation_index',
  modDecision: (id: string) => `moddecision:${id}`,
  modDecisionIndex: 'moddecision_index',
  insight: (id: string) => `insight:${id}`,
  insightIndex: 'insight_index',
};
```

- [ ] **Step 4: Create `src/types/mod-decision.ts`**

```typescript
export type ModAction =
  | 'removelink'
  | 'approvelink'
  | 'removecomment'
  | 'approvecomment'
  | 'spamlink'
  | 'spamcomment';

export interface ModDecision {
  targetId: string;
  action: ModAction;
  moderator: string;
  timestamp: number;
  subredditId: string;
}
```

- [ ] **Step 5: Create `src/storage/mod-decision-store.ts`**

```typescript
import type { KVStore } from '@devvit/public-api';
import { KEYS } from './keys';
import type { ModDecision } from '../types/mod-decision';

export async function saveDecision(kv: KVStore, decision: ModDecision): Promise<void> {
  await kv.put(KEYS.modDecision(decision.targetId), JSON.stringify(decision));
  const raw = await kv.get(KEYS.modDecisionIndex);
  const ids: string[] = raw ? JSON.parse(raw as string) : [];
  if (!ids.includes(decision.targetId)) ids.push(decision.targetId);
  await kv.put(KEYS.modDecisionIndex, JSON.stringify(ids));
}

export async function getDecision(kv: KVStore, targetId: string): Promise<ModDecision | null> {
  const raw = await kv.get(KEYS.modDecision(targetId));
  return raw ? JSON.parse(raw as string) : null;
}

export async function listDecisions(kv: KVStore): Promise<ModDecision[]> {
  const raw = await kv.get(KEYS.modDecisionIndex);
  if (!raw) return [];
  const ids: string[] = JSON.parse(raw as string);
  const results = await Promise.all(ids.map((id) => getDecision(kv, id)));
  return results.filter((d): d is ModDecision => d !== null);
}

export async function clearDecisions(kv: KVStore): Promise<void> {
  const raw = await kv.get(KEYS.modDecisionIndex);
  if (!raw) return;
  const ids: string[] = JSON.parse(raw as string);
  await Promise.all([
    ...ids.map((id) => kv.delete(KEYS.modDecision(id))),
    kv.delete(KEYS.modDecisionIndex),
  ]);
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
npx jest tests/storage/mod-decision-store.test.ts --no-coverage
```

Expected: PASS — 7 tests passing.

- [ ] **Step 7: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/storage/keys.ts src/types/mod-decision.ts \
  src/storage/mod-decision-store.ts tests/storage/mod-decision-store.test.ts
git commit -m "feat: add ModDecision type, mod-decision-store, and storage keys"
```

---

## Task 9: ConsistencyInsight type + insight store + tests

**Files:**
- Create: `src/types/consistency-insight.ts`
- Create: `src/storage/insight-store.ts`
- Create: `tests/storage/insight-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/storage/insight-store.test.ts`:

```typescript
import {
  saveInsight,
  getInsight,
  listInsights,
  acknowledgeInsight,
  clearInsights,
} from '../../src/storage/insight-store';
import { KEYS } from '../../src/storage/keys';
import type { ConsistencyInsight } from '../../src/types/consistency-insight';

const makeKv = () => {
  const store: Record<string, unknown> = {};
  return {
    put: jest.fn(async (k: string, v: unknown) => { store[k] = v; }),
    get: jest.fn(async (k: string) => store[k] ?? undefined),
    delete: jest.fn(async (k: string) => { delete store[k]; }),
  };
};

const sample: ConsistencyInsight = {
  id: 'insight_1000_divergence',
  type: 'divergence',
  detectedAt: 1000000,
  policyId: 'p1',
  policyTitle: 'No Spam',
  description: 'Inconsistent enforcement detected.',
  stats: { removeCount: 7, approveCount: 3, divergenceRatio: 0.3 },
  acknowledged: false,
  acknowledgedAt: null,
};

describe('saveInsight / getInsight', () => {
  it('saves and retrieves a ConsistencyInsight', async () => {
    const kv = makeKv();
    await saveInsight(kv as any, sample);
    expect(kv.put).toHaveBeenCalledWith(KEYS.insight('insight_1000_divergence'), JSON.stringify(sample));
    const result = await getInsight(kv as any, 'insight_1000_divergence');
    expect(result).toEqual(sample);
  });

  it('returns null for unknown id', async () => {
    const kv = makeKv();
    expect(await getInsight(kv as any, 'nope')).toBeNull();
  });
});

describe('listInsights', () => {
  it('returns all saved insights', async () => {
    const kv = makeKv();
    await saveInsight(kv as any, sample);
    await saveInsight(kv as any, { ...sample, id: 'insight_2000_drift', type: 'drift' as const });
    const list = await listInsights(kv as any);
    expect(list).toHaveLength(2);
  });

  it('returns empty array when no insights stored', async () => {
    const kv = makeKv();
    expect(await listInsights(kv as any)).toEqual([]);
  });
});

describe('acknowledgeInsight', () => {
  it('sets acknowledged=true and acknowledgedAt to a positive number', async () => {
    const kv = makeKv();
    await saveInsight(kv as any, sample);
    await acknowledgeInsight(kv as any, 'insight_1000_divergence');
    const result = await getInsight(kv as any, 'insight_1000_divergence');
    expect(result!.acknowledged).toBe(true);
    expect(result!.acknowledgedAt).toBeGreaterThan(0);
  });

  it('no-ops when insight does not exist', async () => {
    const kv = makeKv();
    await expect(acknowledgeInsight(kv as any, 'nope')).resolves.toBeUndefined();
  });
});

describe('clearInsights', () => {
  it('removes all insights and index', async () => {
    const kv = makeKv();
    await saveInsight(kv as any, sample);
    await clearInsights(kv as any);
    expect(await listInsights(kv as any)).toEqual([]);
    expect(await kv.get(KEYS.insightIndex)).toBeUndefined();
  });

  it('no-ops when index is missing', async () => {
    const kv = makeKv();
    await expect(clearInsights(kv as any)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/storage/insight-store.test.ts --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/types/consistency-insight.ts`**

```typescript
export type InsightType = 'divergence' | 'drift' | 'variance';

export interface ConsistencyInsight {
  id: string;
  type: InsightType;
  detectedAt: number;
  policyId: string | null;
  policyTitle: string | null;
  description: string;
  stats: Record<string, number>;
  acknowledged: boolean;
  acknowledgedAt: number | null;
}
```

- [ ] **Step 4: Create `src/storage/insight-store.ts`**

```typescript
import type { KVStore } from '@devvit/public-api';
import { KEYS } from './keys';
import type { ConsistencyInsight } from '../types/consistency-insight';

export async function saveInsight(kv: KVStore, insight: ConsistencyInsight): Promise<void> {
  await kv.put(KEYS.insight(insight.id), JSON.stringify(insight));
  const raw = await kv.get(KEYS.insightIndex);
  const ids: string[] = raw ? JSON.parse(raw as string) : [];
  if (!ids.includes(insight.id)) ids.push(insight.id);
  await kv.put(KEYS.insightIndex, JSON.stringify(ids));
}

export async function getInsight(kv: KVStore, id: string): Promise<ConsistencyInsight | null> {
  const raw = await kv.get(KEYS.insight(id));
  return raw ? JSON.parse(raw as string) : null;
}

export async function listInsights(kv: KVStore): Promise<ConsistencyInsight[]> {
  const raw = await kv.get(KEYS.insightIndex);
  if (!raw) return [];
  const ids: string[] = JSON.parse(raw as string);
  const results = await Promise.all(ids.map((id) => getInsight(kv, id)));
  return results.filter((i): i is ConsistencyInsight => i !== null);
}

export async function acknowledgeInsight(kv: KVStore, id: string): Promise<void> {
  const insight = await getInsight(kv, id);
  if (!insight) return;
  await kv.put(KEYS.insight(id), JSON.stringify({
    ...insight,
    acknowledged: true,
    acknowledgedAt: Date.now(),
  }));
}

export async function clearInsights(kv: KVStore): Promise<void> {
  const raw = await kv.get(KEYS.insightIndex);
  if (!raw) return;
  const ids: string[] = JSON.parse(raw as string);
  await Promise.all([
    ...ids.map((id) => kv.delete(KEYS.insight(id))),
    kv.delete(KEYS.insightIndex),
  ]);
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx jest tests/storage/insight-store.test.ts --no-coverage
```

Expected: PASS — 8 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/types/consistency-insight.ts src/storage/insight-store.ts \
  tests/storage/insight-store.test.ts
git commit -m "feat: add ConsistencyInsight type, insight-store with acknowledge support"
```

---

## Task 10: Mod log fetcher

**Files:**
- Create: `src/consistency/mod-log-fetcher.ts`

No separate test — the fetcher is a thin wrapper over the Reddit API, verified at integration time during `devvit playtest`.

- [ ] **Step 1: Verify mod log API availability**

Check if `getModerationLog` exists on `RedditAPIClient`:

```bash
grep -r "getModerationLog\|getModeratorActions\|getModerationActions" \
  node_modules/@devvit/public-api/dist --include="*.d.ts" -l 2>/dev/null | head -5
```

If found: use the discovered method name. If not found, proceed with the protos fallback path in the file below (the `fetchViaProtos` branch).

- [ ] **Step 2: Create `src/consistency/mod-log-fetcher.ts`**

```typescript
import type { RedditAPIClient } from '@devvit/public-api';
import type { ModDecision, ModAction } from '../types/mod-decision';

const TRACKED_ACTIONS: Set<string> = new Set([
  'removelink', 'approvelink', 'removecomment', 'approvecomment', 'spamlink', 'spamcomment',
]);

export async function fetchModLog(
  reddit: RedditAPIClient,
  subredditName: string
): Promise<ModDecision[]> {
  try {
    // Attempt public API first; method name may differ by SDK version
    const client = reddit as any;
    const logMethod =
      client.getModerationLog ??
      client.getModeratorActions ??
      client.getModerationActions;

    if (!logMethod) {
      console.warn('fetchModLog: no mod log method found on RedditAPIClient — returning empty');
      return [];
    }

    const entries: any[] = await logMethod.call(client, {
      subredditName,
      limit: 100,
    });

    return entries
      .filter((e: any) => TRACKED_ACTIONS.has(e.action ?? e.type))
      .map((e: any): ModDecision => ({
        targetId: e.targetFullname ?? e.target_fullname ?? e.targetId ?? '',
        action: (e.action ?? e.type) as ModAction,
        moderator: e.moderatorName ?? e.mod ?? e.author ?? '',
        timestamp: typeof e.createdAt === 'number'
          ? e.createdAt
          : new Date(e.createdAt ?? 0).getTime(),
        subredditId: e.subredditId ?? subredditName,
      }))
      .filter((d) => d.targetId !== '');
  } catch (err) {
    console.error('fetchModLog: failed to fetch mod log:', err);
    return [];
  }
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/consistency/mod-log-fetcher.ts
git commit -m "feat: add fetchModLog with public API detection and graceful fallback"
```

---

## Task 11: Divergence detector + tests

**Files:**
- Create: `src/consistency/divergence-detector.ts`
- Create: `tests/consistency/divergence-detector.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/consistency/divergence-detector.test.ts`:

```typescript
import {
  detectDivergence,
  detectDrift,
  calculateVariance,
} from '../../src/consistency/divergence-detector';
import type { ModDecision } from '../../src/types/mod-decision';
import type { Recommendation } from '../../src/types/recommendation';
import type { PolicyObject } from '../../src/types/policy-object';

function makeDecision(
  targetId: string,
  action: ModDecision['action'],
  timestamp = Date.now()
): ModDecision {
  return { targetId, action, moderator: 'mod1', timestamp, subredditId: 'sub1' };
}

function makeRec(itemId: string, policyId: string | null): Recommendation {
  return {
    itemId,
    suggestedAction: 'remove',
    confidenceScore: 90,
    riskLevel: 'high',
    matchedPolicyId: policyId,
    matchedPolicyTitle: policyId ?? null,
    similarity: 0.9,
    rationale: 'test',
    generatedAt: Date.now(),
  };
}

function makePolicy(id: string, title: string): PolicyObject {
  return { id, source: 'rule', title, text: 'policy text', metadata: {} };
}

describe('detectDivergence', () => {
  it('flags a policy group where minority side is >= 20%', () => {
    // 7 removes, 3 approves out of 10 → 30% minority → flagged
    const decisions = [
      ...Array.from({ length: 7 }, (_, i) => makeDecision(`t3_r${i}`, 'removelink')),
      ...Array.from({ length: 3 }, (_, i) => makeDecision(`t3_a${i}`, 'approvelink')),
    ];
    const recs = decisions.map((d) => makeRec(d.targetId, 'p1'));
    const signals = detectDivergence(decisions, recs, [makePolicy('p1', 'No Spam')]);
    expect(signals).toHaveLength(1);
    expect(signals[0].policyId).toBe('p1');
    expect(signals[0].policyTitle).toBe('No Spam');
    expect(signals[0].removeCount).toBe(7);
    expect(signals[0].approveCount).toBe(3);
  });

  it('does NOT flag when minority side is < 20%', () => {
    // 9 removes, 1 approve → 10% minority → not flagged
    const decisions = [
      ...Array.from({ length: 9 }, (_, i) => makeDecision(`t3_r${i}`, 'removelink')),
      makeDecision('t3_a0', 'approvelink'),
    ];
    const recs = decisions.map((d) => makeRec(d.targetId, 'p1'));
    const signals = detectDivergence(decisions, recs, [makePolicy('p1', 'No Spam')]);
    expect(signals).toHaveLength(0);
  });

  it('does NOT flag groups with fewer than 5 decisions', () => {
    const decisions = [
      makeDecision('t3_r0', 'removelink'),
      makeDecision('t3_r1', 'removelink'),
      makeDecision('t3_a0', 'approvelink'),
    ];
    const recs = decisions.map((d) => makeRec(d.targetId, 'p1'));
    const signals = detectDivergence(decisions, recs, [makePolicy('p1', 'No Spam')]);
    expect(signals).toHaveLength(0);
  });

  it('ignores decisions with no matching recommendation', () => {
    const decisions = [makeDecision('t3_unknown', 'removelink')];
    const recs: Recommendation[] = [];
    const signals = detectDivergence(decisions, recs, [makePolicy('p1', 'No Spam')]);
    expect(signals).toHaveLength(0);
  });
});

describe('detectDrift', () => {
  const now = Date.now();
  const recent = now - 10 * 24 * 60 * 60 * 1000;
  const old = now - 60 * 24 * 60 * 60 * 1000;

  it('flags when recent approve rate differs from historical by >= 30 points', () => {
    // Historical (old): 8 removes + 2 approves = 20% approve
    // Recent: 2 removes + 8 approves = 80% approve → delta = 60 → flagged
    const decisions = [
      ...Array.from({ length: 8 }, (_, i) => makeDecision(`t3_or${i}`, 'removelink', old)),
      ...Array.from({ length: 2 }, (_, i) => makeDecision(`t3_oa${i}`, 'approvelink', old)),
      ...Array.from({ length: 2 }, (_, i) => makeDecision(`t3_rr${i}`, 'removelink', recent)),
      ...Array.from({ length: 8 }, (_, i) => makeDecision(`t3_ra${i}`, 'approvelink', recent)),
    ];
    const recs = decisions.map((d) => makeRec(d.targetId, 'p1'));
    const signals = detectDrift(decisions, recs, [makePolicy('p1', 'No Spam')]);
    expect(signals).toHaveLength(1);
    expect(signals[0].delta).toBeGreaterThanOrEqual(0.3);
  });

  it('does NOT flag when delta < 30 percentage points', () => {
    // Historical: 6 removes + 4 approves = 40% approve
    // Recent: 5 removes + 5 approves = 50% approve → delta = 10 → not flagged
    const decisions = [
      ...Array.from({ length: 6 }, (_, i) => makeDecision(`t3_or${i}`, 'removelink', old)),
      ...Array.from({ length: 4 }, (_, i) => makeDecision(`t3_oa${i}`, 'approvelink', old)),
      ...Array.from({ length: 5 }, (_, i) => makeDecision(`t3_rr${i}`, 'removelink', recent)),
      ...Array.from({ length: 5 }, (_, i) => makeDecision(`t3_ra${i}`, 'approvelink', recent)),
    ];
    const recs = decisions.map((d) => makeRec(d.targetId, 'p1'));
    const signals = detectDrift(decisions, recs, [makePolicy('p1', 'No Spam')]);
    expect(signals).toHaveLength(0);
  });
});

describe('calculateVariance', () => {
  it('returns per-policy action rate distributions for groups >= 5', () => {
    const decisions = [
      ...Array.from({ length: 6 }, (_, i) => makeDecision(`t3_r${i}`, 'removelink')),
      ...Array.from({ length: 4 }, (_, i) => makeDecision(`t3_a${i}`, 'approvelink')),
    ];
    const recs = decisions.map((d) => makeRec(d.targetId, 'p1'));
    const signals = calculateVariance(decisions, recs, [makePolicy('p1', 'No Spam')]);
    expect(signals).toHaveLength(1);
    expect(signals[0].policyId).toBe('p1');
    expect(signals[0].removeRate).toBeCloseTo(0.6);
    expect(signals[0].approveRate).toBeCloseTo(0.4);
    expect(signals[0].sampleSize).toBe(10);
  });

  it('excludes groups with fewer than 5 decisions', () => {
    const decisions = Array.from({ length: 3 }, (_, i) =>
      makeDecision(`t3_r${i}`, 'removelink')
    );
    const recs = decisions.map((d) => makeRec(d.targetId, 'p1'));
    const signals = calculateVariance(decisions, recs, [makePolicy('p1', 'No Spam')]);
    expect(signals).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/consistency/divergence-detector.test.ts --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/consistency/divergence-detector.ts`**

```typescript
import type { ModDecision } from '../types/mod-decision';
import type { Recommendation } from '../types/recommendation';
import type { PolicyObject } from '../types/policy-object';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_GROUP_SIZE = 5;
const DIVERGENCE_THRESHOLD = 0.2;
const DRIFT_THRESHOLD = 0.3;

export interface DivergenceSignal {
  policyId: string;
  policyTitle: string;
  removeCount: number;
  approveCount: number;
  divergenceRatio: number;
}

export interface DriftSignal {
  policyId: string;
  policyTitle: string;
  historicalApproveRate: number;
  recentApproveRate: number;
  delta: number;
}

export interface VarianceSignal {
  policyId: string;
  policyTitle: string;
  removeRate: number;
  approveRate: number;
  escalateRate: number;
  sampleSize: number;
}

function buildItemToPolicy(recs: Recommendation[]): Map<string, string | null> {
  return new Map(recs.map((r) => [r.itemId, r.matchedPolicyId]));
}

function buildPolicyTitles(policies: PolicyObject[]): Map<string, string> {
  return new Map(policies.map((p) => [p.id, p.title]));
}

function isRemove(action: ModDecision['action']): boolean {
  return action === 'removelink' || action === 'removecomment' ||
    action === 'spamlink' || action === 'spamcomment';
}

function isApprove(action: ModDecision['action']): boolean {
  return action === 'approvelink' || action === 'approvecomment';
}

export function detectDivergence(
  decisions: ModDecision[],
  recs: Recommendation[],
  policies: PolicyObject[]
): DivergenceSignal[] {
  const itemToPolicy = buildItemToPolicy(recs);
  const policyTitles = buildPolicyTitles(policies);
  const groups = new Map<string, { removes: number; approves: number }>();

  for (const d of decisions) {
    const policyId = itemToPolicy.get(d.targetId);
    if (!policyId) continue;
    const g = groups.get(policyId) ?? { removes: 0, approves: 0 };
    if (isRemove(d.action)) g.removes++;
    else if (isApprove(d.action)) g.approves++;
    else continue;
    groups.set(policyId, g);
  }

  const signals: DivergenceSignal[] = [];
  for (const [policyId, { removes, approves }] of groups) {
    const total = removes + approves;
    if (total < MIN_GROUP_SIZE) continue;
    const minority = Math.min(removes, approves);
    const ratio = minority / total;
    if (ratio >= DIVERGENCE_THRESHOLD) {
      signals.push({
        policyId,
        policyTitle: policyTitles.get(policyId) ?? policyId,
        removeCount: removes,
        approveCount: approves,
        divergenceRatio: ratio,
      });
    }
  }
  return signals;
}

export function detectDrift(
  decisions: ModDecision[],
  recs: Recommendation[],
  policies: PolicyObject[]
): DriftSignal[] {
  const itemToPolicy = buildItemToPolicy(recs);
  const policyTitles = buildPolicyTitles(policies);
  const cutoff = Date.now() - THIRTY_DAYS_MS;

  type Stats = { allApproves: number; allTotal: number; recentApproves: number; recentTotal: number };
  const groups = new Map<string, Stats>();

  for (const d of decisions) {
    const policyId = itemToPolicy.get(d.targetId);
    if (!policyId) continue;
    if (!isRemove(d.action) && !isApprove(d.action)) continue;
    const s = groups.get(policyId) ?? { allApproves: 0, allTotal: 0, recentApproves: 0, recentTotal: 0 };
    s.allTotal++;
    if (isApprove(d.action)) s.allApproves++;
    if (d.timestamp >= cutoff) {
      s.recentTotal++;
      if (isApprove(d.action)) s.recentApproves++;
    }
    groups.set(policyId, s);
  }

  const signals: DriftSignal[] = [];
  for (const [policyId, s] of groups) {
    if (s.allTotal < MIN_GROUP_SIZE || s.recentTotal < 3) continue;
    const historicalApproveRate = s.allApproves / s.allTotal;
    const recentApproveRate = s.recentApproves / s.recentTotal;
    const delta = Math.abs(recentApproveRate - historicalApproveRate);
    if (delta >= DRIFT_THRESHOLD) {
      signals.push({
        policyId,
        policyTitle: policyTitles.get(policyId) ?? policyId,
        historicalApproveRate,
        recentApproveRate,
        delta,
      });
    }
  }
  return signals;
}

export function calculateVariance(
  decisions: ModDecision[],
  recs: Recommendation[],
  policies: PolicyObject[]
): VarianceSignal[] {
  const itemToPolicy = buildItemToPolicy(recs);
  const policyTitles = buildPolicyTitles(policies);
  type Stats = { removes: number; approves: number; escalates: number };
  const groups = new Map<string, Stats>();

  for (const d of decisions) {
    const policyId = itemToPolicy.get(d.targetId);
    if (!policyId) continue;
    const s = groups.get(policyId) ?? { removes: 0, approves: 0, escalates: 0 };
    if (isRemove(d.action)) s.removes++;
    else if (isApprove(d.action)) s.approves++;
    groups.set(policyId, s);
  }

  return Array.from(groups.entries())
    .map(([policyId, s]) => {
      const total = s.removes + s.approves + s.escalates;
      return {
        policyId,
        policyTitle: policyTitles.get(policyId) ?? policyId,
        removeRate: total ? s.removes / total : 0,
        approveRate: total ? s.approves / total : 0,
        escalateRate: total ? s.escalates / total : 0,
        sampleSize: total,
      };
    })
    .filter((v) => v.sampleSize >= MIN_GROUP_SIZE);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/consistency/divergence-detector.test.ts --no-coverage
```

Expected: PASS — 8 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/consistency/divergence-detector.ts tests/consistency/divergence-detector.test.ts
git commit -m "feat: add divergence detector, drift analyzer, and variance calculator with tests"
```

---

## Task 12: Insight generator + tests

**Files:**
- Create: `src/consistency/insight-generator.ts`
- Create: `tests/consistency/insight-generator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/consistency/insight-generator.test.ts`:

```typescript
import { generateInsight } from '../../src/consistency/insight-generator';
import type { AIProvider } from '../../src/ai/types';
import type { DivergenceSignal } from '../../src/consistency/divergence-detector';

function makeProvider(response: string): AIProvider {
  return {
    embedding: { embed: async () => [[0]] },
    textGen: { complete: async () => response },
  };
}

function makeCaptureProvider(): { provider: AIProvider; getCaptured: () => { sys: string; user: string } } {
  let captured = { sys: '', user: '' };
  return {
    provider: {
      embedding: { embed: async () => [[0]] },
      textGen: {
        complete: async (sys: string, user: string) => {
          captured = { sys, user };
          return 'captured response';
        },
      },
    },
    getCaptured: () => captured,
  };
}

const divergenceSignal: DivergenceSignal = {
  policyId: 'p1',
  policyTitle: 'No Spam',
  removeCount: 7,
  approveCount: 3,
  divergenceRatio: 0.3,
};

describe('generateInsight', () => {
  it('returns a ConsistencyInsight with AI-generated description', async () => {
    const provider = makeProvider('Inconsistent enforcement detected for the No Spam policy.');
    const insight = await generateInsight(divergenceSignal, 'divergence', provider);
    expect(insight.description).toBe('Inconsistent enforcement detected for the No Spam policy.');
    expect(insight.type).toBe('divergence');
    expect(insight.policyId).toBe('p1');
    expect(insight.policyTitle).toBe('No Spam');
    expect(insight.acknowledged).toBe(false);
    expect(insight.acknowledgedAt).toBeNull();
  });

  it('includes policy title and stats in the user prompt', async () => {
    const { provider, getCaptured } = makeCaptureProvider();
    await generateInsight(divergenceSignal, 'divergence', provider);
    const { user } = getCaptured();
    expect(user).toContain('No Spam');
    expect(user).toContain('7');
    expect(user).toContain('3');
  });

  it('system prompt uses policy-aligned language, not blame language', async () => {
    const { provider, getCaptured } = makeCaptureProvider();
    await generateInsight(divergenceSignal, 'divergence', provider);
    const { sys } = getCaptured();
    expect(sys).toContain('policy alignment');
    expect(sys.toLowerCase()).not.toContain('blame');
    expect(sys.toLowerCase()).not.toContain('bias');
    expect(sys.toLowerCase()).not.toContain('mistake');
  });

  it('stats contain divergence numbers for divergence type', async () => {
    const provider = makeProvider('desc');
    const insight = await generateInsight(divergenceSignal, 'divergence', provider);
    expect(insight.stats.removeCount).toBe(7);
    expect(insight.stats.approveCount).toBe(3);
    expect(insight.stats.divergenceRatio).toBeCloseTo(0.3);
  });

  it('generates a unique id each time', async () => {
    const provider = makeProvider('desc');
    const a = await generateInsight(divergenceSignal, 'divergence', provider);
    const b = await generateInsight(divergenceSignal, 'divergence', provider);
    expect(a.id).not.toBe(b.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/consistency/insight-generator.test.ts --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/consistency/insight-generator.ts`**

```typescript
import type { AIProvider } from '../ai/types';
import type { ConsistencyInsight, InsightType } from '../types/consistency-insight';
import type {
  DivergenceSignal,
  DriftSignal,
  VarianceSignal,
} from './divergence-detector';

const SYSTEM_PROMPT =
  'You are a policy alignment analyst for a moderation team. ' +
  'Describe the following enforcement pattern in 2-3 plain sentences. ' +
  'Frame it as operational data, never as moderator blame. ' +
  'Use language like "inconsistent enforcement" or "policy alignment gap", ' +
  'never "bias" or "mistake".';

export async function generateInsight(
  signal: DivergenceSignal | DriftSignal | VarianceSignal,
  type: InsightType,
  provider: AIProvider
): Promise<ConsistencyInsight> {
  const userPrompt = JSON.stringify({ type, ...signal });
  const description = await provider.textGen.complete(SYSTEM_PROMPT, userPrompt);

  const stats: Record<string, number> = {};
  if (type === 'divergence') {
    const s = signal as DivergenceSignal;
    stats.removeCount = s.removeCount;
    stats.approveCount = s.approveCount;
    stats.divergenceRatio = s.divergenceRatio;
  } else if (type === 'drift') {
    const s = signal as DriftSignal;
    stats.historicalApproveRate = s.historicalApproveRate;
    stats.recentApproveRate = s.recentApproveRate;
    stats.delta = s.delta;
  } else {
    const s = signal as VarianceSignal;
    stats.removeRate = s.removeRate;
    stats.approveRate = s.approveRate;
    stats.escalateRate = s.escalateRate;
    stats.sampleSize = s.sampleSize;
  }

  return {
    id: `insight_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${type}`,
    type,
    detectedAt: Date.now(),
    policyId: 'policyId' in signal ? (signal as DivergenceSignal).policyId : null,
    policyTitle: 'policyTitle' in signal ? (signal as DivergenceSignal).policyTitle : null,
    description,
    stats,
    acknowledged: false,
    acknowledgedAt: null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/consistency/insight-generator.test.ts --no-coverage
```

Expected: PASS — 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/consistency/insight-generator.ts tests/consistency/insight-generator.test.ts
git commit -m "feat: add insight generator — calls provider.textGen with policy-aligned system prompt"
```

---

## Task 13: Engine orchestrator + tests

**Files:**
- Create: `src/consistency/engine.ts`
- Create: `tests/consistency/engine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/consistency/engine.test.ts`:

```typescript
import { runConsistencyEngine } from '../../src/consistency/engine';
import type { AIProvider } from '../../src/ai/types';
import type { ModDecision } from '../../src/types/mod-decision';

const makeProvider = (): AIProvider => ({
  embedding: { embed: async () => [[0]] },
  textGen: { complete: async () => 'AI insight text' },
});

const makeReddit = () => ({
  getModerationLog: undefined,
  getModeratorActions: undefined,
  getModerationActions: undefined,
});

function makeKvWithDecisions(count: number) {
  const store: Record<string, unknown> = {};
  const ids: string[] = [];

  for (let i = 0; i < count; i++) {
    const d: ModDecision = {
      targetId: `t3_${i}`,
      action: 'removelink',
      moderator: 'mod1',
      timestamp: Date.now() - i * 1000,
      subredditId: 'sub1',
    };
    ids.push(d.targetId);
    store[`moddecision:t3_${i}`] = JSON.stringify(d);
  }
  store['moddecision_index'] = JSON.stringify(ids);
  store['recommendation_index'] = JSON.stringify([]);
  store['policy_index'] = JSON.stringify([]);
  store['insight_index'] = JSON.stringify([]);

  return {
    put: jest.fn(async (k: string, v: unknown) => { store[k] = v; }),
    get: jest.fn(async (k: string) => store[k] ?? undefined),
    delete: jest.fn(async (k: string) => { delete store[k]; }),
  };
}

describe('runConsistencyEngine', () => {
  it('returns skipped=true and decisionCount when fewer than 50 decisions in store', async () => {
    const kv = makeKvWithDecisions(49);
    const summary = await runConsistencyEngine(
      kv as any, makeProvider(), makeReddit() as any, 'test'
    );
    expect(summary.skipped).toBe(true);
    expect(summary.decisionCount).toBe(49);
    expect(summary.insightsGenerated).toBe(0);
  });

  it('returns skipped=false when >= 50 decisions', async () => {
    const kv = makeKvWithDecisions(50);
    const summary = await runConsistencyEngine(
      kv as any, makeProvider(), makeReddit() as any, 'test'
    );
    expect(summary.skipped).toBe(false);
    expect(summary.decisionCount).toBeGreaterThanOrEqual(50);
  });

  it('summary counts match number of signals generated', async () => {
    const kv = makeKvWithDecisions(50);
    const summary = await runConsistencyEngine(
      kv as any, makeProvider(), makeReddit() as any, 'test'
    );
    expect(summary.insightsGenerated).toBe(
      summary.divergenceCount + summary.driftCount + summary.varianceCount
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/consistency/engine.test.ts --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/consistency/engine.ts`**

```typescript
import type { KVStore, RedditAPIClient } from '@devvit/public-api';
import type { AIProvider } from '../ai/types';
import { fetchModLog } from './mod-log-fetcher';
import { detectDivergence, detectDrift, calculateVariance } from './divergence-detector';
import { generateInsight } from './insight-generator';
import { saveDecision, listDecisions } from '../storage/mod-decision-store';
import { saveInsight } from '../storage/insight-store';
import { getAllRecommendations } from '../storage/recommendation-store';
import { getAllPolicies } from '../storage/policy-store';

export interface ConsistencySummary {
  insightsGenerated: number;
  divergenceCount: number;
  driftCount: number;
  varianceCount: number;
  skipped: boolean;
  decisionCount: number;
}

export async function runConsistencyEngine(
  kv: KVStore,
  provider: AIProvider,
  reddit: RedditAPIClient,
  subredditName: string
): Promise<ConsistencySummary> {
  const freshDecisions = await fetchModLog(reddit, subredditName);
  await Promise.all(freshDecisions.map((d) => saveDecision(kv, d)));

  const decisions = await listDecisions(kv);
  if (decisions.length < 50) {
    return {
      insightsGenerated: 0,
      divergenceCount: 0,
      driftCount: 0,
      varianceCount: 0,
      skipped: true,
      decisionCount: decisions.length,
    };
  }

  const [recommendations, policies] = await Promise.all([
    getAllRecommendations(kv),
    getAllPolicies(kv),
  ]);

  const divergences = detectDivergence(decisions, recommendations, policies);
  const drifts = detectDrift(decisions, recommendations, policies);
  const variances = calculateVariance(decisions, recommendations, policies);

  let insightsGenerated = 0;

  for (const s of divergences) {
    const insight = await generateInsight(s, 'divergence', provider);
    await saveInsight(kv, insight);
    insightsGenerated++;
  }
  for (const s of drifts) {
    const insight = await generateInsight(s, 'drift', provider);
    await saveInsight(kv, insight);
    insightsGenerated++;
  }
  for (const s of variances) {
    const insight = await generateInsight(s, 'variance', provider);
    await saveInsight(kv, insight);
    insightsGenerated++;
  }

  return {
    insightsGenerated,
    divergenceCount: divergences.length,
    driftCount: drifts.length,
    varianceCount: variances.length,
    skipped: false,
    decisionCount: decisions.length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/consistency/engine.test.ts --no-coverage
```

Expected: PASS — 3 tests passing.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/consistency/engine.ts tests/consistency/engine.test.ts
git commit -m "feat: add runConsistencyEngine orchestrator with 50-decision threshold gate"
```

---

## Task 14: Health check update + final verification

**Files:**
- Modify: `src/triggers/health-check.ts`

The `consistency-analysis` job and `AMIS: Consistency Check` menu item were already added to `main.ts` in Task 7 using a dynamic `import()`. Now the engine exists, confirm everything compiles.

- [ ] **Step 1: Update `src/triggers/health-check.ts`**

```typescript
import type { KVStore, UIClient } from '@devvit/public-api';
import { getAllModItemIds } from '../storage/mod-item-store';
import { getEmbedding } from '../storage/embedding-store';
import { listInsights } from '../storage/insight-store';

export async function runHealthCheck(kv: KVStore, ui: UIClient): Promise<void> {
  const ids = await getAllModItemIds(kv);
  let embeddingCount = 0;
  for (const id of ids) {
    const vec = await getEmbedding(kv, id);
    if (vec) embeddingCount++;
  }
  const insights = await listInsights(kv);
  const pending = insights.filter((i) => !i.acknowledged).length;
  ui.showToast(
    `AMIS: ${ids.length} items, ${embeddingCount} embeddings, ${pending} consistency insights pending`
  );
}
```

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Verify exit criteria**

```bash
# main.ts has consistency-analysis job
grep -c 'consistency-analysis' src/main.ts

# main.ts has Consistency Check menu item
grep -c 'Consistency Check' src/main.ts

# main.ts has all 4 new settings
grep -c 'AI_PROVIDER\|AI_API_KEY\|CUSTOM_API_BASE_URL\|CUSTOM_MODEL' src/main.ts

# createAIProvider exists
grep -c 'createAIProvider' src/ai/provider.ts
```

Expected output: each command returns a positive integer.

- [ ] **Step 5: Final commit**

```bash
git add src/triggers/health-check.ts
git commit -m "feat: update health check to show pending consistency insight count"
```

---

## Exit Criterion Summary

- `npm test` all green (existing 15 test files + 6 new = 21 total test files)
- `npx tsc --noEmit` clean
- `main.ts` contains `consistency-analysis` scheduler job, `AMIS: Consistency Check` menu item, and settings for `AI_PROVIDER`, `AI_API_KEY`, `CUSTOM_API_BASE_URL`, `CUSTOM_MODEL`
- `createAIProvider` returns a provider with both `.embedding` and `.textGen` for all four provider types
- Manual trace: `runConsistencyEngine` with a mocked KV containing 49 decisions returns `{ skipped: true, decisionCount: 49 }`

# In-App API Key Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Configure Keys" form to the AMIS SettingsView that stores AI provider credentials in KVStore so moderators never need CLI access to configure the app.

**Architecture:** A new `ai-config-store` handles KVStore persistence of `{ provider, apiKey, voyageKey }`. `createAIProvider` gains an optional `kv` parameter and resolves credentials from KVStore first, falling back to Devvit settings. A Devvit native form (defined at module level in `dashboard-post.tsx`) collects and saves credentials; SettingsView shows per-key status and a Configure button.

**Tech Stack:** TypeScript, Devvit public API (`Devvit.createForm`, `KVStore`), Jest + ts-jest.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/storage/keys.ts` | Modify | Add `aiConfig` KV key constant |
| `src/storage/ai-config-store.ts` | **Create** | `saveAIConfig` / `getAIConfig` — serialize AIConfig to/from KV |
| `tests/storage/ai-config-store.test.ts` | **Create** | Unit tests for ai-config-store |
| `src/ai/provider.ts` | Modify | Accept optional `kv?: KVStore`; resolve from KV first |
| `tests/ai/provider.test.ts` | Modify | Add KV-path and fallback tests |
| `src/ui/settings-view.tsx` | Modify | Add API CONFIGURATION section + `onConfigureKeys` prop |
| `src/ui/dashboard-post.tsx` | Modify | Define `apiConfigForm`; wire configure handler; load key status; fix error toast |
| `src/main.ts` | Modify | Pass `context.kvStore` to every `createAIProvider` call |

---

## Task 1: Add `aiConfig` key to KEYS

**Files:**
- Modify: `src/storage/keys.ts`

- [ ] **Step 1: Add the key**

Open `src/storage/keys.ts`. The current file is:

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
  dashboardPostId: 'dashboard_post_id',
  directActionsEnabled: 'direct_actions_enabled',
  escalation: (id: string) => `escalation:${id}`,
};
```

Add `aiConfig: 'ai_config',` after `directActionsEnabled`:

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
  dashboardPostId: 'dashboard_post_id',
  directActionsEnabled: 'direct_actions_enabled',
  aiConfig: 'ai_config',
  escalation: (id: string) => `escalation:${id}`,
};
```

- [ ] **Step 2: Commit**

```bash
git add src/storage/keys.ts
git commit -m "feat: add aiConfig key to KEYS"
```

---

## Task 2: Create `ai-config-store`

**Files:**
- Create: `src/storage/ai-config-store.ts`
- Create: `tests/storage/ai-config-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/storage/ai-config-store.test.ts`:

```typescript
import { saveAIConfig, getAIConfig } from '../../src/storage/ai-config-store';
import { KEYS } from '../../src/storage/keys';

const makeKv = () => {
  const store: Record<string, unknown> = {};
  return {
    put: jest.fn(async (k: string, v: unknown) => { store[k] = v; }),
    get: jest.fn(async (k: string) => store[k] ?? undefined),
    delete: jest.fn(async (k: string) => { delete store[k]; }),
  };
};

describe('saveAIConfig / getAIConfig', () => {
  it('saves and retrieves config', async () => {
    const kv = makeKv();
    await saveAIConfig(kv as any, { provider: 'claude', apiKey: 'ant-key', voyageKey: 'voy-key' });
    expect(kv.put).toHaveBeenCalledWith(
      KEYS.aiConfig,
      JSON.stringify({ provider: 'claude', apiKey: 'ant-key', voyageKey: 'voy-key' })
    );
    const result = await getAIConfig(kv as any);
    expect(result).toEqual({ provider: 'claude', apiKey: 'ant-key', voyageKey: 'voy-key' });
  });

  it('returns null when no config stored', async () => {
    const kv = makeKv();
    expect(await getAIConfig(kv as any)).toBeNull();
  });

  it('returns null when stored value is malformed JSON', async () => {
    const kv = makeKv();
    await kv.put(KEYS.aiConfig, 'not-json');
    expect(await getAIConfig(kv as any)).toBeNull();
  });

  it('overwrites existing config on second save', async () => {
    const kv = makeKv();
    await saveAIConfig(kv as any, { provider: 'openai', apiKey: 'sk-1', voyageKey: '' });
    await saveAIConfig(kv as any, { provider: 'claude', apiKey: 'ant-2', voyageKey: 'voy-2' });
    const result = await getAIConfig(kv as any);
    expect(result?.provider).toBe('claude');
    expect(result?.apiKey).toBe('ant-2');
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx jest tests/storage/ai-config-store.test.ts --no-coverage
```

Expected: FAIL with "Cannot find module '../../src/storage/ai-config-store'"

- [ ] **Step 3: Implement the store**

Create `src/storage/ai-config-store.ts`:

```typescript
import type { KVStore } from '@devvit/public-api';
import { KEYS } from './keys';

export type AIConfig = {
  provider: string;
  apiKey: string;
  voyageKey: string;
};

export async function saveAIConfig(kv: KVStore, config: AIConfig): Promise<void> {
  await kv.put(KEYS.aiConfig, JSON.stringify(config));
}

export async function getAIConfig(kv: KVStore): Promise<AIConfig | null> {
  const raw = await kv.get(KEYS.aiConfig) as string | undefined;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AIConfig;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx jest tests/storage/ai-config-store.test.ts --no-coverage
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/storage/ai-config-store.ts tests/storage/ai-config-store.test.ts
git commit -m "feat: add ai-config-store for KVStore-backed API key persistence"
```

---

## Task 3: Update `createAIProvider` with KV-first resolution

**Files:**
- Modify: `src/ai/provider.ts`
- Modify: `tests/ai/provider.test.ts`

- [ ] **Step 1: Write the new failing tests**

Open `tests/ai/provider.test.ts`. The existing `makeSettings` helper is already there. Add `makeKv` and four new test cases inside the existing `describe('createAIProvider')` block, after the existing tests:

```typescript
const makeKv = (config?: object) => {
  const store: Record<string, unknown> = config
    ? { ai_config: JSON.stringify(config) }
    : {};
  return {
    put: jest.fn(async (k: string, v: unknown) => { store[k] = v; }),
    get: jest.fn(async (k: string) => store[k] ?? undefined),
    delete: jest.fn(async (k: string) => { delete store[k]; }),
  };
};

it('reads from KVStore when apiKey is present — claude', async () => {
  const settings = makeSettings({});
  const kv = makeKv({ provider: 'claude', apiKey: 'ant-test', voyageKey: 'voy-test' });
  const provider = await createAIProvider(settings, kv as any);
  expect(typeof provider.embedding.embed).toBe('function');
  expect(typeof provider.textGen.complete).toBe('function');
});

it('reads from KVStore when apiKey is present — openai', async () => {
  const settings = makeSettings({});
  const kv = makeKv({ provider: 'openai', apiKey: 'sk-test', voyageKey: '' });
  const provider = await createAIProvider(settings, kv as any);
  expect(typeof provider.embedding.embed).toBe('function');
});

it('falls back to settings when KV has no apiKey', async () => {
  const settings = makeSettings({ AI_PROVIDER: 'openai', AI_API_KEY: 'sk-fallback' });
  const kv = makeKv();
  const provider = await createAIProvider(settings, kv as any);
  expect(typeof provider.embedding.embed).toBe('function');
});

it('falls back to settings when kv parameter is omitted', async () => {
  const settings = makeSettings({ AI_PROVIDER: 'openai', AI_API_KEY: 'sk-fallback' });
  const provider = await createAIProvider(settings);
  expect(typeof provider.embedding.embed).toBe('function');
});
```

- [ ] **Step 2: Run new tests — verify they fail**

```bash
npx jest tests/ai/provider.test.ts --no-coverage
```

Expected: 4 new tests FAIL (existing 9 pass), errors like "Expected 1-2 arguments, but got 2"

- [ ] **Step 3: Update `createAIProvider`**

Replace the entire contents of `src/ai/provider.ts` with:

```typescript
import type { KVStore } from '@devvit/public-api';
import type { AIProvider } from './types';
import { createOpenAIProvider } from './openai';
import { createClaudeProvider } from './claude';
import { createGeminiProvider } from './gemini';
import { createCustomProvider } from './custom';
import { getAIConfig } from '../storage/ai-config-store';

interface Settings {
  get(key: string): Promise<unknown>;
}

export async function createAIProvider(settings: Settings, kv?: KVStore): Promise<AIProvider> {
  if (kv) {
    const stored = await getAIConfig(kv);
    if (stored?.apiKey) {
      const name = stored.provider || 'claude';
      if (name === 'openai') return createOpenAIProvider(stored.apiKey);
      if (name === 'gemini') return createGeminiProvider(stored.apiKey);
      if (name === 'claude') {
        if (!stored.voyageKey) throw new Error('createAIProvider: VOYAGE_API_KEY is required for claude provider');
        return createClaudeProvider(stored.apiKey, stored.voyageKey);
      }
      // custom — baseUrl and model still come from Devvit settings
      if (!stored.voyageKey) throw new Error('createAIProvider: VOYAGE_API_KEY is required for custom provider');
      const baseUrl = (await settings.get('CUSTOM_API_BASE_URL')) as string | undefined;
      if (!baseUrl) throw new Error('createAIProvider: CUSTOM_API_BASE_URL is required for custom provider');
      const model = (await settings.get('CUSTOM_MODEL')) as string | undefined;
      if (!model) throw new Error('createAIProvider: CUSTOM_MODEL is required for custom provider');
      return createCustomProvider(stored.apiKey, stored.voyageKey, baseUrl, model);
    }
  }

  const providerName = (await settings.get('AI_PROVIDER')) as string | undefined ?? 'claude';
  const aiKey = (await settings.get('AI_API_KEY')) as string | undefined;
  if (!aiKey) throw new Error('createAIProvider: AI_API_KEY is not set');

  if (providerName === 'openai') return createOpenAIProvider(aiKey);
  if (providerName === 'gemini') return createGeminiProvider(aiKey);

  const voyageKey = (await settings.get('VOYAGE_API_KEY')) as string | undefined;
  if (!voyageKey) throw new Error(`createAIProvider: VOYAGE_API_KEY is required for ${providerName} provider`);

  if (providerName === 'claude') return createClaudeProvider(aiKey, voyageKey);

  const baseUrl = (await settings.get('CUSTOM_API_BASE_URL')) as string | undefined;
  if (!baseUrl) throw new Error('createAIProvider: CUSTOM_API_BASE_URL is required for custom provider');
  const model = (await settings.get('CUSTOM_MODEL')) as string | undefined;
  if (!model) throw new Error('createAIProvider: CUSTOM_MODEL is required for custom provider');

  return createCustomProvider(aiKey, voyageKey, baseUrl, model);
}
```

- [ ] **Step 4: Run all tests — verify they pass**

```bash
npx jest tests/ai/provider.test.ts --no-coverage
```

Expected: PASS (13 tests — 9 existing + 4 new)

- [ ] **Step 5: Commit**

```bash
git add src/ai/provider.ts tests/ai/provider.test.ts
git commit -m "feat: make createAIProvider read from KVStore first, fall back to settings"
```

---

## Task 4: Update `SettingsView` with API configuration section

**Files:**
- Modify: `src/ui/settings-view.tsx`

No unit tests — UI components have no test files in this codebase (see `tests/ui/helpers.test.ts` which only tests pure helper functions, not components).

- [ ] **Step 1: Replace `settings-view.tsx`**

Replace the entire contents of `src/ui/settings-view.tsx` with:

```typescript
import { Devvit } from '@devvit/public-api';

interface SettingsViewProps {
  aiProvider: string;
  directActionsEnabled: boolean;
  itemCount: number;
  aiKeyConfigured: boolean;
  voyageKeyConfigured: boolean;
  onBack: () => void;
  onToggleDirectActions: () => void | Promise<void>;
  onRefreshQueue: () => void | Promise<void>;
  onConfigureKeys: () => void;
}

export function SettingsView({
  aiProvider,
  directActionsEnabled,
  itemCount,
  aiKeyConfigured,
  voyageKeyConfigured,
  onBack,
  onToggleDirectActions,
  onRefreshQueue,
  onConfigureKeys,
}: SettingsViewProps): JSX.Element {
  return (
    <vstack padding="medium" gap="medium" grow>
      <hstack gap="small" alignment="start middle">
        <button appearance="plain" size="small" onPress={onBack}>← Back</button>
        <text weight="bold" size="medium">Settings</text>
      </hstack>

      <vstack gap="small" padding="small" backgroundColor="#1a1a2e" cornerRadius="small">
        <text size="xsmall" color="#a0a0ff" weight="bold">API CONFIGURATION</text>
        <text size="xsmall">AI Key: {aiKeyConfigured ? 'Configured ✓' : 'Not set ✗'}</text>
        <text size="xsmall">Voyage Key: {voyageKeyConfigured ? 'Configured ✓' : 'Not set ✗'}</text>
        <button
          size="small"
          appearance={aiKeyConfigured ? 'secondary' : 'primary'}
          onPress={onConfigureKeys}
        >
          Configure Keys
        </button>
      </vstack>

      <vstack gap="small" padding="small" backgroundColor="#1a1a2e" cornerRadius="small">
        <text size="xsmall" color="#a0a0ff" weight="bold">AI PROVIDER</text>
        <text size="small">{aiProvider}</text>
      </vstack>

      <vstack gap="small" padding="small" backgroundColor="#1a1a2e" cornerRadius="small">
        <text size="xsmall" color="#a0a0ff" weight="bold">DIRECT ACTIONS</text>
        <text size="xsmall" color="#888888" wrap>
          Execute remove/approve from dashboard without leaving Reddit
        </text>
        <hstack alignment="start middle" gap="small">
          <text size="small" weight="bold">{directActionsEnabled ? 'ON' : 'OFF'}</text>
          <button
            size="small"
            appearance={directActionsEnabled ? 'destructive' : 'secondary'}
            onPress={onToggleDirectActions}
          >
            {directActionsEnabled ? 'Disable' : 'Enable'}
          </button>
        </hstack>
      </vstack>

      <vstack gap="small" padding="small" backgroundColor="#1a1a2e" cornerRadius="small">
        <text size="xsmall" color="#a0a0ff" weight="bold">QUEUE STATUS</text>
        <text size="small">{itemCount} items in queue</text>
        <button size="small" appearance="secondary" onPress={onRefreshQueue}>
          Refresh Queue ↻
        </button>
      </vstack>
    </vstack>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/settings-view.tsx
git commit -m "feat: add API configuration section to SettingsView"
```

---

## Task 5: Update `DashboardPost` — form, key status, error toast

**Files:**
- Modify: `src/ui/dashboard-post.tsx`

- [ ] **Step 1: Replace `dashboard-post.tsx`**

Replace the entire contents of `src/ui/dashboard-post.tsx` with:

```typescript
import { Devvit, useState, useAsync } from '@devvit/public-api';
import { KEYS } from '../storage/keys';
import { getAllRecommendations } from '../storage/recommendation-store';
import { listInsights, acknowledgeInsight } from '../storage/insight-store';
import { getModItem } from '../storage/mod-item-store';
import { getAIConfig, saveAIConfig } from '../storage/ai-config-store';
import { createAIProvider } from '../ai/provider';
import { runQueueProcessor } from '../jobs/queue-processor';
import { sortItemsByRisk } from './helpers';
import { InsightsView } from './insights-view';
import { SettingsView } from './settings-view';
import { TriageView } from './triage-view';
import type { ModItem } from '../types/mod-item';
import type { Recommendation } from '../types/recommendation';
import type { ConsistencyInsight } from '../types/consistency-insight';

type DashboardData = {
  recs: Recommendation[];
  modItems: Record<string, ModItem>;
  insights: ConsistencyInsight[];
  directActionsEnabled: boolean;
  aiProvider: string;
  aiKeyConfigured: boolean;
  voyageKeyConfigured: boolean;
};

const apiConfigForm = Devvit.createForm(
  {
    title: 'Configure API Keys',
    acceptLabel: 'Save',
    fields: [
      {
        type: 'string',
        name: 'provider',
        label: 'AI Provider (claude | openai | gemini | custom)',
        defaultValue: 'claude',
      },
      { type: 'string', name: 'apiKey', label: 'AI API Key' },
      { type: 'string', name: 'voyageKey', label: 'Voyage API Key (required for claude / custom)' },
    ],
  },
  async (event, context) => {
    await saveAIConfig(context.kvStore, {
      provider: (event.values.provider as string) || 'claude',
      apiKey: (event.values.apiKey as string) || '',
      voyageKey: (event.values.voyageKey as string) || '',
    });
    context.ui.showToast('API keys saved');
  }
);

export function DashboardPost(context: Devvit.Context): JSX.Element {
  const { kvStore, reddit, ui, settings, subredditName } = context;

  const [view, setView] = useState('triage');
  const [itemIndex, setItemIndex] = useState(0);
  const [localAcknowledged, setLocalAcknowledged] = useState<string[]>([]);
  const [directActionsEnabled, setDirectActionsEnabled] = useState(false);

  const rawAsync = useAsync(async () => {
    const [rawRecs, rawInsights, rawDirectActions, rawAiProvider, rawConfig] = await Promise.all([
      getAllRecommendations(kvStore),
      listInsights(kvStore),
      kvStore.get(KEYS.directActionsEnabled),
      settings.get<string>('AI_PROVIDER'),
      getAIConfig(kvStore),
    ]);

    const sortedRecs = sortItemsByRisk(rawRecs);

    const modItems: Record<string, ModItem> = {};
    await Promise.all(
      sortedRecs.map(async (rec) => {
        const item = await getModItem(kvStore, rec.itemId);
        if (item) modItems[rec.itemId] = item;
      })
    );

    const result: DashboardData = {
      recs: sortedRecs,
      modItems,
      insights: rawInsights,
      directActionsEnabled: rawDirectActions === 'true',
      aiProvider: rawConfig?.provider ?? (rawAiProvider as string | undefined) ?? 'claude',
      aiKeyConfigured: Boolean(rawConfig?.apiKey),
      voyageKeyConfigured: Boolean(rawConfig?.voyageKey),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result as any;
  }, {
    finally: (loaded, _err) => {
      const typed = loaded as DashboardData | null;
      if (typed) setDirectActionsEnabled(typed.directActionsEnabled);
    },
  });
  const { loading, error } = rawAsync;
  const data = rawAsync.data as DashboardData | null;

  if (loading || !data) {
    return (
      <vstack alignment="center middle" grow>
        <text size="large">⚡ AMIS</text>
        <text color="#888888">Loading queue...</text>
      </vstack>
    );
  }

  if (error) {
    return (
      <vstack alignment="center middle" grow padding="medium" gap="medium">
        <text color="#ff4444" weight="bold">Unable to load queue</text>
        <text color="#888888" size="small" wrap>
          {error.message ?? 'Unknown error — please retry'}
        </text>
      </vstack>
    );
  }

  const { recs, modItems, insights } = data;
  const pendingInsights = insights.filter(
    (i) => !i.acknowledged && !localAcknowledged.includes(i.id)
  );

  const onBack = () => setView('triage');

  const onAcknowledge = async (id: string) => {
    await acknowledgeInsight(kvStore, id);
    setLocalAcknowledged([...localAcknowledged, id]);
  };

  const onToggleDirectActions = async () => {
    const next = !directActionsEnabled;
    await kvStore.put(KEYS.directActionsEnabled, String(next));
    setDirectActionsEnabled(next);
  };

  const onRefreshQueue = async () => {
    try {
      ui.showToast('Refreshing queue...');
      const provider = await createAIProvider(settings, kvStore);
      await runQueueProcessor(subredditName!, kvStore, provider.embedding, reddit);
      ui.showToast('Queue refreshed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      ui.showToast(`Refresh failed: ${msg}`);
    }
  };

  const onConfigureKeys = () => ui.showForm(apiConfigForm);

  const advanceItem = () => setItemIndex(itemIndex + 1);

  if (view === 'insights') {
    return (
      <InsightsView
        insights={pendingInsights}
        onBack={onBack}
        onAcknowledge={onAcknowledge}
      />
    );
  }

  if (view === 'settings') {
    return (
      <SettingsView
        aiProvider={data.aiProvider}
        directActionsEnabled={directActionsEnabled}
        itemCount={recs.length}
        aiKeyConfigured={data.aiKeyConfigured}
        voyageKeyConfigured={data.voyageKeyConfigured}
        onBack={onBack}
        onToggleDirectActions={onToggleDirectActions}
        onRefreshQueue={onRefreshQueue}
        onConfigureKeys={onConfigureKeys}
      />
    );
  }

  return (
    <TriageView
      recs={recs}
      modItems={modItems}
      itemIndex={itemIndex}
      pendingInsightCount={pendingInsights.length}
      directActionsEnabled={directActionsEnabled}
      subredditName={subredditName ?? ''}
      onRemoveDirect={async (id) => {
        await reddit.remove(id, false);
        ui.showToast('Removed ✓');
        advanceItem();
      }}
      onApproveDirect={async (id) => {
        await reddit.approve(id);
        ui.showToast('Approved ✓');
        advanceItem();
      }}
      onNavigateToQueue={() => {
        ui.navigateTo(`https://www.reddit.com/r/${subredditName ?? ''}/about/modqueue`);
      }}
      onSkip={advanceItem}
      onEscalate={async (id) => {
        await kvStore.put(KEYS.escalation(id), 'true');
        ui.showToast('Escalated ✓');
        advanceItem();
      }}
      onViewInsights={() => setView('insights')}
      onViewSettings={() => setView('settings')}
      onRefresh={onRefreshQueue}
    />
  );
}
```

- [ ] **Step 2: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: all existing tests still PASS (dashboard-post has no unit tests; the change is compile-time verifiable)

- [ ] **Step 3: Commit**

```bash
git add src/ui/dashboard-post.tsx
git commit -m "feat: wire apiConfigForm and key-status display in DashboardPost; surface real error on refresh failure"
```

---

## Task 6: Pass `kvStore` to `createAIProvider` in `main.ts`

**Files:**
- Modify: `src/main.ts`

There are five `createAIProvider(context.settings)` calls — all become `createAIProvider(context.settings, context.kvStore)`.

- [ ] **Step 1: Update the queue-processor scheduler job (line ~101)**

```typescript
// Before
const provider = await createAIProvider(context.settings);
await runQueueProcessor(context.subredditName, context.kvStore, provider.embedding, context.reddit);

// After
const provider = await createAIProvider(context.settings, context.kvStore);
await runQueueProcessor(context.subredditName, context.kvStore, provider.embedding, context.reddit);
```

- [ ] **Step 2: Update the policy-refresh scheduler job (line ~115)**

```typescript
// Before
const provider = await createAIProvider(context.settings);
const result = await runPolicyRefresh(

// After
const provider = await createAIProvider(context.settings, context.kvStore);
const result = await runPolicyRefresh(
```

- [ ] **Step 3: Update the consistency-analysis scheduler job (line ~156)**

```typescript
// Before
const provider = await createAIProvider(context.settings);
const summary = await runConsistencyEngine(

// After
const provider = await createAIProvider(context.settings, context.kvStore);
const summary = await runConsistencyEngine(
```

- [ ] **Step 4: Update the "Refresh Policy" menu item (line ~187)**

```typescript
// Before
const provider = await createAIProvider(context.settings);
const result = await runPolicyRefresh(

// After
const provider = await createAIProvider(context.settings, context.kvStore);
const result = await runPolicyRefresh(
```

- [ ] **Step 5: Update the "Consistency Check" menu item (line ~229)**

```typescript
// Before
const provider = await createAIProvider(context.settings);
const summary = await runConsistencyEngine(

// After
const provider = await createAIProvider(context.settings, context.kvStore);
const summary = await runConsistencyEngine(
```

- [ ] **Step 6: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: PASS (all tests — main.ts has no unit tests, change is structural only)

- [ ] **Step 7: Commit**

```bash
git add src/main.ts
git commit -m "feat: pass kvStore to createAIProvider in all main.ts callers"
```

---

## Verification

After all 6 tasks are complete:

- [ ] Run the full suite one final time:

```bash
npx jest --no-coverage
```

Expected output: all tests pass, no failures.

- [ ] Upload and playtest:

```bash
devvit upload
devvit playtest <subreddit>
```

Flow to verify:
1. Open AMIS Dashboard → go to Settings
2. See **API CONFIGURATION** section showing "Not set ✗" for both keys
3. Press **Configure Keys** → native form appears with three fields
4. Enter provider (`claude`), AI API Key, Voyage API Key → Save
5. Settings section now shows "Configured ✓" for both keys
6. Press **Refresh Queue** — succeeds (no more "Refresh failed")
7. If keys are wrong, toast shows the actual error (e.g. `Refresh failed: createAIProvider: VOYAGE_API_KEY is required for claude provider`)

# Design Spec: In-App API Key Configuration

**Date:** 2026-05-12  
**Status:** Approved  
**Scope:** Add API key configuration UI to the AMIS dashboard so moderators can enter and store credentials without CLI access.

---

## Problem

`createAIProvider` throws when `AI_API_KEY` or `VOYAGE_API_KEY` are not set, causing all queue-dependent operations to fail with a generic "Refresh failed — try again" toast. Devvit's native settings page is not accessible in the current deployment context, and `context.settings.set()` does not exist in the Devvit public API. Moderators have no in-app path to configure credentials.

---

## Solution Overview

Store API configuration in KVStore under a single key. KVStore is server-side only, scoped to the app+subreddit, and never exposed to clients — safe enough for mod tooling credentials. A Devvit native form dialog in the SettingsView collects and saves the config. `createAIProvider` reads from KVStore first, falling back to Devvit settings so CLI-configured keys continue to work.

---

## Data Layer

### New KV key — `src/storage/keys.ts`

```
aiConfig: 'ai_config'
```

### New store — `src/storage/ai-config-store.ts`

```typescript
type AIConfig = {
  provider: string;   // 'claude' | 'openai' | 'gemini' | 'custom'
  apiKey: string;
  voyageKey: string;  // empty string when not needed
};

saveAIConfig(kv: KVStore, config: AIConfig): Promise<void>
getAIConfig(kv: KVStore): Promise<AIConfig | null>
```

`saveAIConfig` serialises to JSON and writes under `KEYS.aiConfig`.  
`getAIConfig` reads and parses; returns `null` if the key is absent or unparseable.

---

## Provider Update — `src/ai/provider.ts`

`createAIProvider` gains an optional second parameter `kv?: KVStore`.

Resolution order:
1. If `kv` is provided, call `getAIConfig(kv)`.
2. If a config with a non-empty `apiKey` is found, use it — skip reading from `settings`.
3. Otherwise fall back to existing `settings.get('AI_PROVIDER')` / `settings.get('AI_API_KEY')` / `settings.get('VOYAGE_API_KEY')` logic unchanged.

This means all callers that already pass `settings` continue to work without modification to their logic; passing `kv` additionally enables the KVStore path.

All callers in `main.ts` (scheduler jobs, menu items) and `dashboard-post.tsx` are updated to pass `context.kvStore` as the second argument.

---

## Settings UI

### SettingsView — `src/ui/settings-view.tsx`

New `SettingsViewProps` fields:

```typescript
aiKeyConfigured: boolean;
voyageKeyConfigured: boolean;
onConfigureKeys: () => void;
```

New **API CONFIGURATION** section (rendered between the existing AI PROVIDER and DIRECT ACTIONS sections):

```
API CONFIGURATION
AI Key:     Configured ✓   [or: Not set ✗]
Voyage Key: Configured ✓   [or: Not set ✗]
[Configure Keys]
```

Button appearance: `secondary` when all keys configured, `primary` when any key is missing.

### Form definition — `src/ui/dashboard-post.tsx`

Defined at module level (Devvit requirement — forms cannot be defined inside components):

```typescript
const apiConfigForm = Devvit.createForm(
  {
    title: 'Configure API Keys',
    acceptLabel: 'Save',
    fields: [
      { type: 'string', name: 'provider', label: 'AI Provider (claude | openai | gemini | custom)', defaultValue: 'claude' },
      { type: 'string', name: 'apiKey',   label: 'AI API Key' },
      { type: 'string', name: 'voyageKey', label: 'Voyage API Key (required for claude / custom)' },
    ],
  },
  async (event, context) => {
    const { provider, apiKey, voyageKey } = event.values;
    await saveAIConfig(context.kvStore, {
      provider: (provider as string) || 'claude',
      apiKey: (apiKey as string) || '',
      voyageKey: (voyageKey as string) || '',
    });
    context.ui.showToast('API keys saved');
  }
);
```

`onConfigureKeys` in `DashboardPost` calls `context.ui.showForm(apiConfigForm)`.

### DashboardPost data load — `src/ui/dashboard-post.tsx`

The existing `useAsync` callback adds one more parallel read:

```typescript
const rawConfig = await getAIConfig(kvStore);
```

Result is included in `DashboardData`:

```typescript
aiKeyConfigured: boolean;      // rawConfig?.apiKey non-empty
voyageKeyConfigured: boolean;  // rawConfig?.voyageKey non-empty
```

The existing `aiProvider` field in `DashboardData` is derived from KVStore first: `rawConfig?.provider ?? (rawAiProvider as string | undefined) ?? 'claude'`. This keeps the displayed provider in sync with whatever the form saved.

These values are forwarded to `SettingsView` as props.

---

## Error Surfacing Fix — `src/ui/dashboard-post.tsx`

The silent catch in `onRefreshQueue` is updated to surface the actual error:

```typescript
} catch (err) {
  const msg = err instanceof Error ? err.message : 'Unknown error';
  ui.showToast(`Refresh failed: ${msg}`);
}
```

---

## Files Changed

| File | Change |
|------|--------|
| `src/storage/keys.ts` | Add `aiConfig: 'ai_config'` |
| `src/storage/ai-config-store.ts` | **New** — `saveAIConfig`, `getAIConfig` |
| `src/ai/provider.ts` | Accept optional `kv?: KVStore`; KVStore-first resolution |
| `src/ui/settings-view.tsx` | Add API config section; add `aiKeyConfigured`, `voyageKeyConfigured`, `onConfigureKeys` props |
| `src/ui/dashboard-post.tsx` | Define `apiConfigForm`; wire `onConfigureKeys`; load key status in `useAsync`; fix error toast |
| `src/main.ts` | Pass `context.kvStore` to all `createAIProvider` calls |

---

## Security Notes

- KVStore data is stored server-side on Devvit's infrastructure, never sent to the client.
- The store is scoped to the app+subreddit — no other app or subreddit can read it.
- Fields are rendered as plain text inputs (Devvit has no password input type), but the form runs in the moderator-only dashboard context.
- If Devvit native settings (`isSecret: true`) are configured via CLI, they take effect as fallback — the KVStore path wins only when `apiKey` is non-empty.
- For higher-security deployments, CLI-only setup via `devvit settings set` remains available and unaffected by this change.

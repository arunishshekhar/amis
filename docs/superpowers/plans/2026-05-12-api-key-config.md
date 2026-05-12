# In-App API Key Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a built-in key configuration flow to the AMIS dashboard so moderators can securely save AI provider credentials in KVStore instead of depending only on settings values.

**Architecture:** Persist `AIConfig` in KVStore under `KEYS.aiConfig`. `createAIProvider()` accepts an optional `KVStore` and resolves stored credentials before falling back to Devvit settings. The dashboard `SettingsView` shows credential status and exposes a `Configure Keys` action. `DashboardPost` loads config state, renders the settings panel, and saves new values.

**Tech Stack:** TypeScript, Devvit public API (`KVStore`, dashboard forms), Jest.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/storage/keys.ts` | Modify | Confirm/add `aiConfig` KV key |
| `src/storage/ai-config-store.ts` | Create | `saveAIConfig` / `getAIConfig` |
| `tests/storage/ai-config-store.test.ts` | Create | unit tests for KV persistence |
| `src/ai/provider.ts` | Modify | accept optional `KVStore`; use KV config first |
| `tests/ai/provider.test.ts` | Modify | add KV config tests |
| `src/ui/settings-view.tsx` | Modify | add API config status panel + configure button |
| `src/ui/dashboard-post.tsx` | Modify | load config status; wire configuration form; persist KV data |
| `src/main.ts` | Modify | pass `context.kvStore` into `createAIProvider` calls |

---

## Task 1: Confirm `aiConfig` storage key

**Files:**
- Modify: `src/storage/keys.ts`

- [ ] Ensure `KEYS.aiConfig` exists.
- [ ] If missing, add it after `directActionsEnabled`:

```typescript
  directActionsEnabled: 'direct_actions_enabled',
  aiConfig: 'ai_config',
  escalation: (id: string) => `escalation:${id}`,
```

- [ ] Commit:

```bash
git add src/storage/keys.ts
git commit -m "feat: add aiConfig key to KEYS"
```

---

## Task 2: Create the KV-backed AI config store

**Files:**
- Create: `src/storage/ai-config-store.ts`
- Create: `tests/storage/ai-config-store.test.ts`

- [ ] Write failing tests for `saveAIConfig` and `getAIConfig`.
- [ ] Confirm failure with:

```bash
npx jest tests/storage/ai-config-store.test.ts --no-coverage
```

- [ ] Implement `src/storage/ai-config-store.ts` with:

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
  const raw = (await kv.get(KEYS.aiConfig)) as string | undefined;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AIConfig;
  } catch {
    return null;
  }
}
```

- [ ] Verify passing tests:

```bash
npx jest tests/storage/ai-config-store.test.ts --no-coverage
```

- [ ] Commit:

```bash
git add src/storage/ai-config-store.ts tests/storage/ai-config-store.test.ts
git commit -m "feat: add ai-config-store for KV-backed AI credentials"
```

---

## Task 3: Extend `createAIProvider` to use KV credentials

**Files:**
- Modify: `src/ai/provider.ts`
- Modify: `tests/ai/provider.test.ts`

- [ ] Add an optional `kv?: KVStore` argument to `createAIProvider`.
- [ ] If `kv` is provided, read stored config with `getAIConfig(kv)`.
- [ ] Use stored `provider`, `apiKey`, and `voyageKey` when available.
- [ ] Otherwise retain existing fallback logic to `settings.get(...)`.

- [ ] Add tests for:
  - KV-backed credential resolution
  - fallback to settings when KV is empty
  - support when `kv` is omitted

- [ ] Run:

```bash
npx jest tests/ai/provider.test.ts --no-coverage
```

- [ ] Commit:

```bash
git add src/ai/provider.ts tests/ai/provider.test.ts
git commit -m "feat: support KV-backed AI credentials in createAIProvider"
```

---

## Task 4: Add the in-app API key settings flow

**Files:**
- Modify: `src/ui/settings-view.tsx`
- Modify: `src/ui/dashboard-post.tsx`

- [ ] Extend `SettingsView` with:
  - `keyStatus: 'configured' | 'missing' | 'invalid'`
  - `onConfigureKeys: () => void | Promise<void>`

- [ ] Add a new API configuration panel in `SettingsView`.

- [ ] In `DashboardPost`, import `getAIConfig` and `saveAIConfig`.
- [ ] Load stored config when the dashboard loads and derive `keyStatus`.
- [ ] Implement `onConfigureKeys()` to show a form, persist values to KV, and reload state.

- [ ] Pass `keyStatus` and `onConfigureKeys` into `SettingsView`.

- [ ] Commit:

```bash
git add src/ui/settings-view.tsx src/ui/dashboard-post.tsx
git commit -m "feat: add in-dashboard API key configuration UI"
```

---

## Task 5: Pass KVStore into provider initialization everywhere

**Files:**
- Modify: `src/main.ts`
- Modify: `src/ui/dashboard-post.tsx`

- [ ] Update all `createAIProvider(context.settings)` calls in `src/main.ts` to:

```ts
createAIProvider(context.settings, context.kvStore)
```

- [ ] Update dashboard refresh in `src/ui/dashboard-post.tsx` to:

```ts
const provider = await createAIProvider(settings, kvStore);
```

- [ ] Run type-check:

```bash
npx tsc --noEmit
```

- [ ] Commit:

```bash
git add src/main.ts src/ui/dashboard-post.tsx
git commit -m "chore: pass KVStore into createAIProvider across all call sites"
```

---

## Task 6: Validate and document

- [ ] Run the full suite:

```bash
npm test -- --runInBand
```

- [ ] In `devvit playtest r/yoursubreddit`, verify:
  - the Settings view shows API config status
  - `Configure Keys` opens the form
  - saved credentials persist in KVStore
  - queue refresh works with KV-backed config

- [ ] Update `README.md` if needed to document the new flow.

- [ ] Final commit:

```bash
git add docs/superpowers/plans/2026-05-12-api-key-config.md
git commit -m "docs: complete API key configuration implementation plan"
```

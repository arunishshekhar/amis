# Phase 4 — Consistency Analytics Design

**Date:** 2026-05-11
**Depends on:** Phase 3 (Recommendations Engine complete)
**Unlocks:** Phase 5 (UX + Ship)

---

## Overview

Phase 4 delivers two things:

1. **AI Provider Abstraction** — a cross-cutting refactor replacing the hardcoded Voyage AI embedding client with a configurable `AIProvider` interface. Moderators choose their own AI provider (OpenAI, Claude, Gemini, or a custom OpenAI-compatible endpoint) and supply their own API key.

2. **Consistency Analytics Engine** — detects patterns where similar content received different moderation outcomes, surfaces rule drift, and generates AI-powered plain-language insights. All output is framed as operational policy analytics, never as moderator blame.

---

## Section 1: AI Provider Abstraction

### Interfaces (`src/ai/types.ts`)

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

The existing Voyage AI client in `src/embeddings/client.ts` already satisfies the `EmbeddingClient` shape — it is re-typed to implement the interface without rewriting.

### Provider Implementations

| File | Embedding model | Text model |
|---|---|---|
| `src/ai/openai.ts` | `text-embedding-3-small` | `gpt-4o-mini` |
| `src/ai/claude.ts` | *delegates to Voyage AI* | `claude-haiku-4-5` |
| `src/ai/gemini.ts` | `text-embedding-004` | `gemini-2.0-flash` |
| `src/ai/custom.ts` | *delegates to Voyage AI* | Custom base URL + model |

When Claude or Custom is selected, the factory delegates embeddings to the existing Voyage AI client using `VOYAGE_API_KEY`. This preserves full backward compatibility.

### Factory Function (`src/ai/provider.ts`)

`createAIProvider(settings: KVStore)` reads the `AI_PROVIDER` setting and returns a fully-constructed `AIProvider`. Throws a descriptive error if required keys are missing (e.g., `AI_API_KEY` not set).

### New Devvit Settings

Added to `main.ts` `Devvit.addSettings([...])`:

| Setting name | Type | Secret | Purpose |
|---|---|---|---|
| `AI_PROVIDER` | string | No | `openai` \| `claude` \| `gemini` \| `custom` |
| `AI_API_KEY` | string | Yes | API key for the chosen provider |
| `CUSTOM_API_BASE_URL` | string | No | Base URL (custom provider only) |
| `CUSTOM_MODEL` | string | No | Model name (custom provider only) |

`VOYAGE_API_KEY` remains as-is for backward compatibility and for Claude/Custom embedding fallback.

### Refactor Impact on Existing Code

Every scheduler job in `main.ts` that currently constructs a Voyage AI embedding client directly is updated to use the factory:

**Before:**
```typescript
const apiKey = await context.settings.get<string>('VOYAGE_API_KEY');
const embeddingClient = createEmbeddingClient(apiKey);
await runSomething(..., embeddingClient, ...);
```

**After:**
```typescript
const provider = await createAIProvider(context.settings);
await runSomething(..., provider.embedding, ...);
```

Function signatures for `runQueueProcessor`, `runPolicyRefresh`, and `runRecommendationEngine` are unchanged — the `EmbeddingClient` parameter type now resolves from the new interface rather than from `embeddings/client.ts`, but the shape is identical.

---

## Section 2: Mod Decision Data Layer

### Type (`src/types/mod-decision.ts`)

```typescript
export type ModAction =
  | 'removelink' | 'approvelink'
  | 'removecomment' | 'approvecomment'
  | 'spamlink' | 'spamcomment';

export interface ModDecision {
  targetId: string;     // Reddit fullname (t3_xxx or t1_xxx)
  action: ModAction;
  moderator: string;    // stored for variance calc only; never displayed by name
  timestamp: number;    // Unix ms
  subredditId: string;
}
```

### Mod Log Fetching (`src/consistency/mod-log-fetcher.ts`)

Calls `context.reddit.getModerationLog({ subredditName, limit: 100 })` and filters for the six `ModAction` types (bans, flair changes, and other actions are discarded). Returns `ModDecision[]`.

**Fallback:** If `getModerationLog` is absent from the public API (as happened with subreddit rules in Phase 2), the implementation falls back to the `@devvit/protos` Subreddits RPC. The plan task will verify availability first and choose the path accordingly.

### Storage Pattern

Keys added to `src/storage/keys.ts`:

```typescript
export const KEY_MOD_DECISION = (targetId: string) => `moddecision:${targetId}`;
export const KEY_MOD_DECISION_INDEX = 'moddecision_index';
```

`src/storage/mod-decision-store.ts` implements `saveDecision`, `getDecision`, `listDecisions`, `clearDecisions` — following the same CRUD pattern as `policy-store.ts`. One record per target; latest action for a given target overwrites the previous one.

---

## Section 3: Consistency Analytics Engine

### Type (`src/types/consistency-insight.ts`)

```typescript
export type InsightType = 'divergence' | 'drift' | 'variance';

export interface ConsistencyInsight {
  id: string;
  type: InsightType;
  detectedAt: number;
  policyId: string | null;
  policyTitle: string | null;
  description: string;              // AI-generated plain language
  stats: Record<string, number>;    // supporting statistics
  acknowledged: boolean;
  acknowledgedAt: number | null;
}
```

### Storage Pattern

Keys added to `src/storage/keys.ts`:

```typescript
export const KEY_INSIGHT = (id: string) => `insight:${id}`;
export const KEY_INSIGHT_INDEX = 'insight_index';
```

`src/storage/insight-store.ts` implements `saveInsight`, `getInsight`, `listInsights`, `acknowledgeInsight`, `clearInsights`. `acknowledgeInsight` sets `acknowledged: true` and `acknowledgedAt: Date.now()`.

### Detection Algorithms (`src/consistency/divergence-detector.ts`)

All three algorithms are pure functions — no KV or network access. They receive plain arrays of data and return signal objects.

**Algorithm 1 — Divergence detector:**
- Groups `ModDecision` records by `matchedPolicyId` (cross-referenced via stored `Recommendation` records)
- For each policy group with ≥ 5 decisions, computes remove% vs approve%
- Flags as divergence if minority side ≥ 20% (e.g., 3 approved out of 10 = 30% → flagged)
- Returns `DivergenceSignal[]`: `{ policyId, policyTitle, removeCount, approveCount, divergenceRatio }`

**Algorithm 2 — Rule drift analyzer:**
- For each policy, computes historical approve rate (all time) vs recent approve rate (last 30 days)
- Flags if delta ≥ 30 percentage points in either direction
- Returns `DriftSignal[]`: `{ policyId, policyTitle, historicalApproveRate, recentApproveRate, delta }`

**Algorithm 3 — Enforcement variance:**
- Aggregates per-policy action distributions across all stored decisions
- No per-moderator breakdown — subreddit-wide percentages only
- Returns `VarianceSignal[]`: `{ policyId, removeRate, approveRate, escalateRate, sampleSize }`

### Insight Generator (`src/consistency/insight-generator.ts`)

For each detected signal, calls `provider.textGen.complete()` with:

**System prompt:**
> "You are a policy alignment analyst for a moderation team. Describe the following enforcement pattern in 2–3 plain sentences. Frame it as operational data, never as moderator blame. Use language like 'inconsistent enforcement' or 'policy alignment gap', never 'bias' or 'mistake'."

**User prompt:** Compact JSON of the signal type, policy title, and stats.

Returns a `ConsistencyInsight` with `description` populated from the AI response. Each insight gets a unique ID (`insight_${Date.now()}_${type}`).

### Engine Orchestrator (`src/consistency/engine.ts`)

```
runConsistencyEngine(kvStore, provider, reddit, subredditName):
  1. fetchModLog(reddit, subredditName) → upsert each entry to ModDecisionStore
  2. listDecisions() → if count < 50, return { skipped: true, reason: 'insufficient_history', decisionCount: N }
  3. listDecisions() + listRecommendations() + listPolicies() from KV
  4. runDivergenceDetector(decisions, recommendations, policies)
  5. runDriftAnalyzer(decisions, recommendations, policies)
  6. runVarianceCalculator(decisions, recommendations, policies)
  7. For each signal: generateInsight(signal, provider) → saveInsight()
  8. Return ConsistencySummary { insightsGenerated, divergenceCount, driftCount, varianceCount, skipped }
```

---

## Section 4: Triggers & Wiring

### New Scheduler Job (`main.ts`)

```typescript
Devvit.addSchedulerJob({
  name: 'consistency-analysis',
  onRun: async (_event, context) => {
    if (!context.subredditName) return;
    const provider = await createAIProvider(context.settings);
    const summary = await runConsistencyEngine(
      context.kvStore, provider, context.reddit, context.subredditName
    );
    console.log(`consistency-analysis: ${summary.insightsGenerated} insights generated`);
  },
});
```

### AppInstall Trigger (updated)

Two additional `runJob` calls added to the existing `AppInstall` trigger:

```typescript
await context.scheduler.runJob({
  name: 'consistency-analysis',
  runAt: new Date(Date.now() + 15000),  // after recommendation-run at 5s
});
await context.scheduler.runJob({
  name: 'consistency-analysis',
  cron: '0 2 * * *',  // daily at 2am
});
```

### New Menu Item

```typescript
Devvit.addMenuItem({
  label: 'AMIS: Consistency Check',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    const provider = await createAIProvider(context.settings);
    const summary = await runConsistencyEngine(
      context.kvStore, provider, context.reddit, context.subredditName!
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
```

### Health Check Update

`src/triggers/health-check.ts` gains one additional KV read: `listInsights()` → appends `${pending} consistency insights pending` to the existing health check toast (acknowledged insights are excluded from the count).

---

## Section 5: Testing Strategy

All tests follow Phase 1–3 TDD pattern: write the test first (red), implement (green), commit.

### New Test Files

| File | What it tests |
|---|---|
| `tests/ai/provider.test.ts` | Factory returns correct provider per `AI_PROVIDER` value; Claude provider uses Voyage embedding; missing `AI_API_KEY` throws descriptive error |
| `tests/consistency/divergence-detector.test.ts` | Divergence flagging at boundary ratios (19% below threshold, 20% at threshold); drift delta threshold; variance aggregation correctness |
| `tests/consistency/insight-generator.test.ts` | Mocks `textGen.complete()`; verifies prompt contains policy title and stats; verifies returned `ConsistencyInsight` has correct type and `acknowledged: false` |
| `tests/consistency/engine.test.ts` | Threshold gate (< 50 decisions returns `skipped: true`); full run with mocked detector output; summary counts match signals generated |
| `tests/storage/mod-decision-store.test.ts` | `saveDecision` / `listDecisions` / `clearDecisions` round-trips |
| `tests/storage/insight-store.test.ts` | `saveInsight` / `acknowledgeInsight` (flips `acknowledged` and `acknowledgedAt`) / `listInsights` |

### Exit Criterion

- `npm test` all green
- `npx tsc --noEmit` clean
- `main.ts` contains `consistency-analysis` scheduler job, `AMIS: Consistency Check` menu item, and four new settings (`AI_PROVIDER`, `AI_API_KEY`, `CUSTOM_API_BASE_URL`, `CUSTOM_MODEL`)
- `createAIProvider` returns a provider with both `.embedding` and `.textGen` for all four provider types
- Manual trace: `runConsistencyEngine` with a mocked KV containing 49 decisions returns `{ skipped: true, decisionCount: 49 }`

---

## File Inventory

### New Files (20)

```
src/ai/types.ts
src/ai/provider.ts
src/ai/openai.ts
src/ai/claude.ts
src/ai/gemini.ts
src/ai/custom.ts
src/types/mod-decision.ts
src/types/consistency-insight.ts
src/storage/mod-decision-store.ts
src/storage/insight-store.ts
src/consistency/mod-log-fetcher.ts
src/consistency/divergence-detector.ts
src/consistency/insight-generator.ts
src/consistency/engine.ts
tests/ai/provider.test.ts
tests/consistency/divergence-detector.test.ts
tests/consistency/insight-generator.test.ts
tests/consistency/engine.test.ts
tests/storage/mod-decision-store.test.ts
tests/storage/insight-store.test.ts
```

### Modified Files (6)

```
src/storage/keys.ts          — add KEY_MOD_DECISION, KEY_MOD_DECISION_INDEX, KEY_INSIGHT, KEY_INSIGHT_INDEX
src/main.ts                  — new settings, consistency-analysis job, menu item, provider factory in all jobs
src/embeddings/client.ts     — re-typed to satisfy EmbeddingClient interface
src/embeddings/generator.ts  — receive EmbeddingClient via parameter (no internal construction)
src/jobs/queue-processor.ts  — receive provider.embedding from caller
src/triggers/health-check.ts — append insight count to toast
```

---

## Hard Constraints

- Never surface per-moderator named rankings or comparison tables
- All output framed as "policy alignment analytics" — no "bias", "mistake", or "error" language
- Insights are advisory only; no action is pre-applied or suggested as automatic
- Minimum 50 historical decisions before running any detection algorithm
- `moderator` field in `ModDecision` stored only for aggregate variance calculation; never included in any UI output or AI prompt

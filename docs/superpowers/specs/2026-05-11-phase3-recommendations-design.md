# Phase 3 — Recommendations Engine Design

**Date:** 2026-05-11
**Project:** AI Moderation Intelligence System (AMIS)
**Phase:** 3 of 5 — first moderator-visible output

---

## Summary

Phase 3 builds the Recommendation Engine: given a moderation queue item and the policy store from Phase 2, produce a `Recommendation` object (suggested action, confidence score, risk level, rationale) and persist it. Moderators access results via a new "AMIS: Analyze Queue" menu item that runs the engine and returns a summary toast.

**Scope decisions:**
- No Claude API — rationale is generated from deterministic templates
- Per-item recommendations only — no semantic clustering (deferred to Phase 4)
- Menu item + toast output — no Devvit UI blocks (deferred to Phase 5)
- No moderation history tracking — "related examples" field omitted from MVP

---

## Architecture

```
ModItem (Phase 1) ──→ embedding vector (Phase 1)
                              ↓
                     searchPolicies (Phase 2)
                              ↓
                  generateRecommendation (Phase 3, pure)
                              ↓
                  saveRecommendation (Phase 3, KV)
                              ↓
              "AMIS: Analyze Queue" menu item → toast summary
```

---

## Section 1: Types and Storage

### `Recommendation` type (`src/types/recommendation.ts`)

```ts
export type SuggestedAction = 'remove' | 'approve' | 'escalate' | 'monitor';
export type RiskLevel = 'low' | 'medium' | 'high';

export interface Recommendation {
  itemId: string;
  suggestedAction: SuggestedAction;
  confidenceScore: number;        // 0–100
  riskLevel: RiskLevel;
  matchedPolicyId: string | null;
  matchedPolicyTitle: string | null;
  similarity: number;             // raw cosine score of best policy match
  rationale: string;              // deterministic template string
  generatedAt: number;            // Unix ms
}
```

### Storage keys (extend `src/storage/keys.ts`)

```ts
recommendation: (id: string) => `recommendation:${id}`,
recommendationIndex: 'recommendation_index',
```

### `RecommendationStore` (`src/storage/recommendation-store.ts`)

Three functions, matching the pattern in `policy-store.ts`:

- `saveRecommendation(kv: KVStore, rec: Recommendation): Promise<void>`
  - Stores `recommendation:{itemId}` → JSON
  - Adds `itemId` to `recommendation_index` (array of IDs, JSON-serialized)
- `getRecommendation(kv: KVStore, itemId: string): Promise<Recommendation | null>`
- `getAllRecommendations(kv: KVStore): Promise<Recommendation[]>`
  - Reads index, fetches each by ID, filters nulls

---

## Section 2: Recommendation Generator

### `src/recommendations/generator.ts`

Pure function — no I/O, fully unit-testable:

```ts
export function generateRecommendation(
  item: ModItem,
  policyMatches: Array<{ policy: PolicyObject; similarity: number }>
): Recommendation
```

### Action and confidence mapping

Uses the top policy match (highest cosine similarity):

| Condition | Action | Risk | Confidence |
|---|---|---|---|
| similarity ≥ 0.85 | `remove` | `high` | `75 + similarity * 25` |
| similarity ≥ 0.70 | `remove` | `medium` | `50 + similarity * 30` |
| similarity ≥ 0.50 | `monitor` | `medium` | `30 + similarity * 20` |
| similarity < 0.50 or no matches | `approve` | `low` | `80` (fixed — strong "within guidelines" signal) |

**Escalation override:** if `item.reportReasons.length >= 3` AND best similarity ≥ 0.50, action becomes `escalate` and confidence is boosted by `+10` (capped at 100).

All confidence values are rounded to the nearest integer.

### Rationale templates

```
remove:    `Likely violates "${policy.title}". Matched at ${pct}% similarity. Risk level: ${risk}.`
monitor:   `Possible concern: "${policy.title}" (${pct}% match). Review before taking action.`
approve:   `No strong policy match found. Content appears within guidelines.`
escalate:  `High report volume with policy match — warrants moderator escalation: "${policy.title}" (${pct}% match).`
```

Where `pct = Math.round(similarity * 100)`.

When `policyMatches` is empty, `matchedPolicyId` and `matchedPolicyTitle` are `null`; the `approve` template is used regardless of report count.

---

## Section 3: Engine and Wiring

### `src/recommendations/engine.ts`

```ts
export interface RecommendationSummary {
  processed: number;
  removed: number;
  monitored: number;
  approved: number;
  escalated: number;
}

export async function runRecommendationEngine(
  kv: KVStore,
  embeddingClient: VoyageAIClient
): Promise<RecommendationSummary>
```

**Flow:**
1. Load all ModItem IDs from `mod_item_index`
2. Load all items from KV
3. For each item:
   a. Load its embedding vector from `embedding:{id}`
   b. Call `searchPolicies(kv, vector, topK=3)`
   c. Call `generateRecommendation(item, matches)`
   d. Call `saveRecommendation(kv, rec)`
4. Return aggregate counts by `suggestedAction`

Items with no stored embedding are skipped (logged as warning, not thrown).

### `main.ts` additions

**New scheduler job: `recommendation-run`**
```ts
Devvit.addSchedulerJob({
  name: 'recommendation-run',
  onRun: async (_event, context) => { ... }
})
```

**AppInstall trigger change:** After scheduling `queue-processor` cron and `policy-refresh` one-shot, also schedule `recommendation-run` as a one-shot (runs immediately after install, after queue data is available).

**Practical note:** Because Devvit does not guarantee job ordering, the `recommendation-run` one-shot is scheduled with a 5-second delay (`new Date(Date.now() + 5000)`) to give `queue-processor` time to run first on install.

**New menu item: `AMIS: Analyze Queue`**
```ts
Devvit.addMenuItem({
  label: 'AMIS: Analyze Queue',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    const summary = await runRecommendationEngine(kv, embeddingClient);
    context.ui.showToast(
      `Analysis: ${summary.removed} remove, ${summary.monitored} monitor, ` +
      `${summary.approved} approve, ${summary.escalated} escalate`
    );
  }
})
```

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/types/recommendation.ts` | Create | `Recommendation`, `SuggestedAction`, `RiskLevel` types |
| `src/storage/keys.ts` | Modify | Add `recommendation` and `recommendationIndex` keys |
| `src/storage/recommendation-store.ts` | Create | `saveRecommendation`, `getRecommendation`, `getAllRecommendations` |
| `src/recommendations/generator.ts` | Create | Pure `generateRecommendation` function |
| `src/recommendations/engine.ts` | Create | `runRecommendationEngine` orchestrator |
| `src/main.ts` | Modify | `recommendation-run` scheduler job, `AMIS: Analyze Queue` menu item, AppInstall update |
| `tests/storage/recommendation-store.test.ts` | Create | CRUD round-trips, index management |
| `tests/recommendations/generator.test.ts` | Create | All action branches, escalation override, no-match case |
| `tests/recommendations/engine.test.ts` | Create | Integration with mocked KV and embedding client |

9 file changes total (2 new types, 2 new storage/engine files, 1 new recommendations dir, 3 test files, 2 modifications).

---

## Testing Strategy

All tests use the DI pattern established in Phases 1 and 2: KV and embedding client are injected, no real network calls.

**`recommendation-store.test.ts`:** Save → get round-trip, save multiple → getAll, duplicate save overwrites, getAll on empty store returns [].

**`generator.test.ts`:** One test per action branch (similarity ≥ 0.85, 0.70–0.85, 0.50–0.70, < 0.50, no matches), escalation override with report count ≥ 3, escalation suppressed when similarity < 0.50, confidence capped at 100.

**`engine.test.ts`:** Mock KV with stored items + embeddings + policies, verify summary counts match expected actions, verify missing embeddings are skipped gracefully.

---

## Exit Criterion

Phase 3 is complete when:
1. `npm test` passes with all new tests green
2. `npm run build` compiles with no TypeScript errors
3. The "AMIS: Analyze Queue" menu item is wired in `main.ts`
4. A manual trace through `generateRecommendation` with known inputs produces the expected action, confidence, and rationale string

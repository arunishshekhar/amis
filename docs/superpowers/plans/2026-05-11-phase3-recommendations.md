# Phase 3 — Recommendations Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Recommendation Engine — given a moderation queue item and the policy store from Phase 2, produce a persisted `Recommendation` object (suggested action, confidence, risk level, template-based rationale) and expose it via a new "AMIS: Analyze Queue" moderator menu item.

**Architecture:** A pure `generateRecommendation` function maps cosine similarity to action/confidence/rationale deterministically; a `runRecommendationEngine` orchestrator reads all stored `ModItem` embeddings, calls the existing `searchPolicies` searcher from Phase 2, invokes the generator, and persists results. A new scheduler job and menu item in `main.ts` wire everything together. No Claude API — rationale is template-string only.

**Tech Stack:** `@devvit/public-api`, `voyageai` (already installed), TypeScript, Jest.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/types/recommendation.ts` | **Create** | `Recommendation` interface, `SuggestedAction` and `RiskLevel` union types |
| `src/storage/keys.ts` | **Modify** | Add `recommendation` and `recommendationIndex` key helpers |
| `src/storage/recommendation-store.ts` | **Create** | `saveRecommendation`, `getRecommendation`, `getAllRecommendations` |
| `src/recommendations/generator.ts` | **Create** | Pure `generateRecommendation` — no I/O, deterministic from similarity + report count |
| `src/recommendations/engine.ts` | **Create** | `runRecommendationEngine` orchestrator — reads KV, calls searcher + generator, persists |
| `src/main.ts` | **Modify** | Add `recommendation-run` scheduler job, `AMIS: Analyze Queue` menu item, update AppInstall |
| `tests/storage/recommendation-store.test.ts` | **Create** | CRUD round-trips, index deduplication |
| `tests/recommendations/generator.test.ts` | **Create** | All action branches, escalation override, edge cases |
| `tests/recommendations/engine.test.ts` | **Create** | Integration with mocked KV, missing-embedding skip |

---

## Task 1: `Recommendation` Type

**Files:**
- Create: `src/types/recommendation.ts`

No test needed — pure TypeScript types verified by the TypeScript compiler when imported in later tasks.

- [ ] **Step 1: Create the type file**

```typescript
// src/types/recommendation.ts
export type SuggestedAction = 'remove' | 'approve' | 'escalate' | 'monitor';
export type RiskLevel = 'low' | 'medium' | 'high';

export interface Recommendation {
  itemId: string;
  suggestedAction: SuggestedAction;
  confidenceScore: number;        // 0–100, rounded integer
  riskLevel: RiskLevel;
  matchedPolicyId: string | null;
  matchedPolicyTitle: string | null;
  similarity: number;             // raw cosine score of best policy match
  rationale: string;              // deterministic template string
  generatedAt: number;            // Unix ms
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/arunish-shekhar/mod-app && npx tsc --noEmit
```

Expected: no errors (or only pre-existing errors unrelated to this file).

- [ ] **Step 3: Commit**

```bash
git add src/types/recommendation.ts
git commit -m "feat: add Recommendation type for Phase 3"
```

---

## Task 2: Extend Storage Keys

**Files:**
- Modify: `src/storage/keys.ts`

The current file has: `modItem`, `embedding`, `modItemIndex`, `policy`, `policyIndex`, `policyEmbedding`. Add `recommendation` and `recommendationIndex`.

- [ ] **Step 1: Add the two new keys to `KEYS`**

The full file after the change:

```typescript
// src/storage/keys.ts
export const KEYS = {
  modItem: (id: string) => `mod_item:${id}`,
  embedding: (id: string) => `embedding:${id}`,
  modItemIndex: 'mod_item_index',
  policy: (id: string) => `policy:${id}`,
  policyIndex: 'policy_index',
  policyEmbedding: (id: string) => `policy_embedding:${id}`,
  recommendation: (id: string) => `recommendation:${id}`,
  recommendationIndex: 'recommendation_index',
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/arunish-shekhar/mod-app && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/storage/keys.ts
git commit -m "feat: add recommendation and recommendationIndex keys"
```

---

## Task 3: `RecommendationStore`

**Files:**
- Create: `src/storage/recommendation-store.ts`
- Create: `tests/storage/recommendation-store.test.ts`

Follow the exact same pattern as `src/storage/policy-store.ts`. The index stores an array of itemIds as a JSON string; deduplication prevents double-adding the same ID.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/storage/recommendation-store.test.ts
import {
  saveRecommendation,
  getRecommendation,
  getAllRecommendations,
} from '../../src/storage/recommendation-store';
import { KEYS } from '../../src/storage/keys';
import type { Recommendation } from '../../src/types/recommendation';

const mockRec: Recommendation = {
  itemId: 'p1',
  suggestedAction: 'remove',
  confidenceScore: 95,
  riskLevel: 'high',
  matchedPolicyId: 'rule:0',
  matchedPolicyTitle: 'No spam',
  similarity: 0.91,
  rationale: 'Likely violates "No spam". Matched at 91% similarity. Risk level: high.',
  generatedAt: 1000,
};

const makeKv = () => {
  const store: Record<string, unknown> = {};
  return {
    put: jest.fn(async (k: string, v: unknown) => { store[k] = v; }),
    get: jest.fn(async (k: string) => store[k] ?? undefined),
    delete: jest.fn(async (k: string) => { delete store[k]; }),
  };
};

describe('saveRecommendation / getRecommendation', () => {
  it('stores and retrieves a Recommendation by itemId', async () => {
    const kv = makeKv();
    await saveRecommendation(kv as any, mockRec);
    expect(kv.put).toHaveBeenCalledWith(KEYS.recommendation('p1'), JSON.stringify(mockRec));
    const result = await getRecommendation(kv as any, 'p1');
    expect(result).toEqual(mockRec);
  });

  it('returns null for unknown itemId', async () => {
    const kv = makeKv();
    expect(await getRecommendation(kv as any, 'nope')).toBeNull();
  });

  it('adds itemId to recommendationIndex on first save', async () => {
    const kv = makeKv();
    await saveRecommendation(kv as any, mockRec);
    const raw = await kv.get(KEYS.recommendationIndex);
    expect(JSON.parse(raw as string)).toContain('p1');
  });

  it('does not duplicate itemId in index on repeated save', async () => {
    const kv = makeKv();
    await saveRecommendation(kv as any, mockRec);
    await saveRecommendation(kv as any, { ...mockRec, confidenceScore: 90 });
    const raw = await kv.get(KEYS.recommendationIndex);
    const ids: string[] = JSON.parse(raw as string);
    expect(ids.filter((id) => id === 'p1')).toHaveLength(1);
  });
});

describe('getAllRecommendations', () => {
  it('returns all recommendations listed in recommendationIndex', async () => {
    const kv = makeKv();
    await saveRecommendation(kv as any, mockRec);
    const results = await getAllRecommendations(kv as any);
    expect(results).toEqual([mockRec]);
  });

  it('returns empty array when index is missing', async () => {
    const kv = makeKv();
    expect(await getAllRecommendations(kv as any)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/arunish-shekhar/mod-app && npx jest tests/storage/recommendation-store.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '../../src/storage/recommendation-store'`

- [ ] **Step 3: Implement `recommendation-store.ts`**

```typescript
// src/storage/recommendation-store.ts
import type { KVStore } from '@devvit/public-api';
import { KEYS } from './keys';
import type { Recommendation } from '../types/recommendation';

export async function saveRecommendation(kv: KVStore, rec: Recommendation): Promise<void> {
  await kv.put(KEYS.recommendation(rec.itemId), JSON.stringify(rec));
  const raw = await kv.get(KEYS.recommendationIndex);
  const ids: string[] = raw ? JSON.parse(raw as string) : [];
  if (!ids.includes(rec.itemId)) ids.push(rec.itemId);
  await kv.put(KEYS.recommendationIndex, JSON.stringify(ids));
}

export async function getRecommendation(kv: KVStore, itemId: string): Promise<Recommendation | null> {
  const raw = await kv.get(KEYS.recommendation(itemId));
  return raw ? JSON.parse(raw as string) : null;
}

export async function getAllRecommendations(kv: KVStore): Promise<Recommendation[]> {
  const raw = await kv.get(KEYS.recommendationIndex);
  if (!raw) return [];
  const ids: string[] = JSON.parse(raw as string);
  const results = await Promise.all(ids.map((id) => getRecommendation(kv, id)));
  return results.filter((r): r is Recommendation => r !== null);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/arunish-shekhar/mod-app && npx jest tests/storage/recommendation-store.test.ts --no-coverage
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/recommendation-store.ts tests/storage/recommendation-store.test.ts
git commit -m "feat: add RecommendationStore with save/get/getAll"
```

---

## Task 4: `generateRecommendation` (Pure Generator)

**Files:**
- Create: `src/recommendations/generator.ts`
- Create: `tests/recommendations/generator.test.ts`

This is a pure function — no I/O, no KV, no API calls. It takes a `ModItem` and the sorted `policyMatches` array (already sorted by similarity descending, as returned by `searchPolicies`) and returns a `Recommendation`.

**Logic summary:**
- Best match = `policyMatches[0]` (highest similarity)
- `similarity >= 0.85` → `remove / high`, confidence = `75 + similarity * 25`
- `0.70 <= similarity < 0.85` → `remove / medium`, confidence = `50 + similarity * 30`
- `0.50 <= similarity < 0.70` → `monitor / medium`, confidence = `30 + similarity * 20`
- `similarity < 0.50` or no matches → `approve / low`, confidence = `80` (fixed)
- **Escalation override:** if `item.reportReasons.length >= 3` AND best similarity `>= 0.50`, action becomes `escalate` and raw confidence gets `+10`
- All confidence values: `Math.min(100, Math.round(rawConfidence))`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/recommendations/generator.test.ts
import { generateRecommendation } from '../../src/recommendations/generator';
import type { ModItem } from '../../src/types/mod-item';
import type { PolicyObject } from '../../src/types/policy-object';

const makeItem = (overrides: Partial<ModItem> = {}): ModItem => ({
  id: 'p1',
  author: 'alice',
  timestamp: 1000,
  title: 'Test Post',
  body: 'Some content',
  reportReasons: [],
  contentType: 'post',
  subredditId: 't5_abc',
  ...overrides,
});

const makePolicy = (id = 'rule:0', title = 'No spam'): PolicyObject => ({
  id,
  source: 'rule',
  title,
  text: 'No spam allowed.',
  metadata: {},
});

describe('generateRecommendation — action branches', () => {
  it('returns remove/high when similarity >= 0.85', () => {
    const result = generateRecommendation(makeItem(), [{ policy: makePolicy(), similarity: 0.9 }]);
    expect(result.suggestedAction).toBe('remove');
    expect(result.riskLevel).toBe('high');
    expect(result.confidenceScore).toBe(Math.round(75 + 0.9 * 25));
    expect(result.matchedPolicyId).toBe('rule:0');
    expect(result.matchedPolicyTitle).toBe('No spam');
    expect(result.rationale).toContain('No spam');
    expect(result.rationale).toContain('90%');
  });

  it('returns remove/medium when 0.70 <= similarity < 0.85', () => {
    const result = generateRecommendation(makeItem(), [{ policy: makePolicy(), similarity: 0.75 }]);
    expect(result.suggestedAction).toBe('remove');
    expect(result.riskLevel).toBe('medium');
    expect(result.confidenceScore).toBe(Math.round(50 + 0.75 * 30));
    expect(result.rationale).toContain('medium');
  });

  it('returns monitor/medium when 0.50 <= similarity < 0.70', () => {
    const result = generateRecommendation(makeItem(), [{ policy: makePolicy(), similarity: 0.6 }]);
    expect(result.suggestedAction).toBe('monitor');
    expect(result.riskLevel).toBe('medium');
    expect(result.confidenceScore).toBe(Math.round(30 + 0.6 * 20));
    expect(result.rationale).toContain('Possible concern');
  });

  it('returns approve/low when similarity < 0.50', () => {
    const result = generateRecommendation(makeItem(), [{ policy: makePolicy(), similarity: 0.3 }]);
    expect(result.suggestedAction).toBe('approve');
    expect(result.riskLevel).toBe('low');
    expect(result.confidenceScore).toBe(80);
    expect(result.rationale).toContain('No strong policy match');
  });

  it('returns approve/low when policyMatches is empty', () => {
    const result = generateRecommendation(makeItem(), []);
    expect(result.suggestedAction).toBe('approve');
    expect(result.riskLevel).toBe('low');
    expect(result.confidenceScore).toBe(80);
    expect(result.matchedPolicyId).toBeNull();
    expect(result.matchedPolicyTitle).toBeNull();
    expect(result.rationale).toContain('No strong policy match');
  });
});

describe('generateRecommendation — escalation override', () => {
  it('escalates when reportReasons.length >= 3 and similarity >= 0.50', () => {
    const item = makeItem({ reportReasons: ['spam', 'harassment', 'misinformation'] });
    const result = generateRecommendation(item, [{ policy: makePolicy(), similarity: 0.72 }]);
    expect(result.suggestedAction).toBe('escalate');
    expect(result.rationale).toContain('escalation');
    expect(result.rationale).toContain('No spam');
  });

  it('does not escalate when reportReasons.length >= 3 but similarity < 0.50', () => {
    const item = makeItem({ reportReasons: ['spam', 'harassment', 'misinformation'] });
    const result = generateRecommendation(item, [{ policy: makePolicy(), similarity: 0.3 }]);
    expect(result.suggestedAction).toBe('approve');
  });

  it('does not escalate when similarity >= 0.50 but reportReasons.length < 3', () => {
    const item = makeItem({ reportReasons: ['spam', 'harassment'] });
    const result = generateRecommendation(item, [{ policy: makePolicy(), similarity: 0.72 }]);
    expect(result.suggestedAction).toBe('remove');
  });
});

describe('generateRecommendation — confidence and metadata', () => {
  it('caps confidence at 100', () => {
    const item = makeItem({ reportReasons: ['a', 'b', 'c'] });
    const result = generateRecommendation(item, [{ policy: makePolicy(), similarity: 1.0 }]);
    expect(result.confidenceScore).toBeLessThanOrEqual(100);
  });

  it('sets itemId from the ModItem', () => {
    const result = generateRecommendation(makeItem({ id: 'abc' }), []);
    expect(result.itemId).toBe('abc');
  });

  it('sets generatedAt to a current timestamp', () => {
    const before = Date.now();
    const result = generateRecommendation(makeItem(), []);
    expect(result.generatedAt).toBeGreaterThanOrEqual(before);
    expect(result.generatedAt).toBeLessThanOrEqual(Date.now());
  });

  it('sets similarity to 0 when no policy matches', () => {
    const result = generateRecommendation(makeItem(), []);
    expect(result.similarity).toBe(0);
  });

  it('uses the best match similarity (first in sorted array)', () => {
    const matches = [
      { policy: makePolicy('rule:0', 'No spam'), similarity: 0.92 },
      { policy: makePolicy('rule:1', 'Be civil'), similarity: 0.6 },
    ];
    const result = generateRecommendation(makeItem(), matches);
    expect(result.similarity).toBe(0.92);
    expect(result.matchedPolicyId).toBe('rule:0');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/arunish-shekhar/mod-app && npx jest tests/recommendations/generator.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '../../src/recommendations/generator'`

- [ ] **Step 3: Create `src/recommendations/` directory and implement `generator.ts`**

```typescript
// src/recommendations/generator.ts
import type { ModItem } from '../types/mod-item';
import type { PolicyObject } from '../types/policy-object';
import type { Recommendation, SuggestedAction, RiskLevel } from '../types/recommendation';

export function generateRecommendation(
  item: ModItem,
  policyMatches: Array<{ policy: PolicyObject; similarity: number }>
): Recommendation {
  const best = policyMatches.length > 0 ? policyMatches[0] : null;
  const similarity = best?.similarity ?? 0;
  const policy = best?.policy ?? null;

  let action: SuggestedAction;
  let risk: RiskLevel;
  let rawConfidence: number;

  if (!best || similarity < 0.50) {
    action = 'approve';
    risk = 'low';
    rawConfidence = 80;
  } else if (similarity >= 0.85) {
    action = 'remove';
    risk = 'high';
    rawConfidence = 75 + similarity * 25;
  } else if (similarity >= 0.70) {
    action = 'remove';
    risk = 'medium';
    rawConfidence = 50 + similarity * 30;
  } else {
    // 0.50 <= similarity < 0.70
    action = 'monitor';
    risk = 'medium';
    rawConfidence = 30 + similarity * 20;
  }

  // Escalation override: high report volume + meaningful policy match
  if (item.reportReasons.length >= 3 && best && similarity >= 0.50) {
    action = 'escalate';
    rawConfidence += 10;
  }

  const confidenceScore = Math.min(100, Math.round(rawConfidence));
  const pct = Math.round(similarity * 100);

  let rationale: string;
  if (action === 'approve') {
    rationale = 'No strong policy match found. Content appears within guidelines.';
  } else if (action === 'escalate') {
    rationale = `High report volume with policy match — warrants moderator escalation: "${policy!.title}" (${pct}% match).`;
  } else if (action === 'remove') {
    rationale = `Likely violates "${policy!.title}". Matched at ${pct}% similarity. Risk level: ${risk}.`;
  } else {
    // monitor
    rationale = `Possible concern: "${policy!.title}" (${pct}% match). Review before taking action.`;
  }

  return {
    itemId: item.id,
    suggestedAction: action,
    confidenceScore,
    riskLevel: risk,
    matchedPolicyId: policy?.id ?? null,
    matchedPolicyTitle: policy?.title ?? null,
    similarity,
    rationale,
    generatedAt: Date.now(),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/arunish-shekhar/mod-app && npx jest tests/recommendations/generator.test.ts --no-coverage
```

Expected: all 13 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/recommendations/generator.ts tests/recommendations/generator.test.ts
git commit -m "feat: add pure generateRecommendation with deterministic action mapping"
```

---

## Task 5: `runRecommendationEngine` (Orchestrator)

**Files:**
- Create: `src/recommendations/engine.ts`
- Create: `tests/recommendations/engine.test.ts`

The engine reads existing data from KV — it does NOT call Voyage AI to generate new embeddings. It reads the embeddings stored by Phase 1's `generateAndStoreEmbeddings`. The KV dependencies chain is:
- `mod_item_index` → list of item IDs
- `mod_item:{id}` → `ModItem` JSON (via `getModItem` from `src/storage/mod-item-store.ts`)
- `embedding:{id}` → number[] JSON (via `getEmbedding` from `src/storage/embedding-store.ts`)
- `policy_index` + `policy:{id}` + `policy_embedding:{id}` → consumed internally by `searchPolicies`

Items with no stored embedding are skipped with a `console.warn`, not thrown.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/recommendations/engine.test.ts
import { runRecommendationEngine } from '../../src/recommendations/engine';
import { KEYS } from '../../src/storage/keys';
import type { ModItem } from '../../src/types/mod-item';
import type { PolicyObject } from '../../src/types/policy-object';

const mockItem: ModItem = {
  id: 'p1',
  author: 'alice',
  timestamp: 1000,
  title: 'Buy cheap meds',
  body: 'Discount meds at example.com',
  reportReasons: ['spam'],
  contentType: 'post',
  subredditId: 't5_abc',
};

const mockPolicy: PolicyObject = {
  id: 'rule:0',
  source: 'rule',
  title: 'No spam',
  text: 'No spam',
  metadata: {},
};

// Full KV store with one item, its embedding, and one policy with embedding.
// Cosine similarity between [1,0,0] and [0.99,0.1,0] is ~0.995 → remove/high.
const makeFullKv = () => {
  const store: Record<string, string> = {
    [KEYS.modItemIndex]: JSON.stringify(['p1']),
    [KEYS.modItem('p1')]: JSON.stringify(mockItem),
    [KEYS.embedding('p1')]: JSON.stringify([1, 0, 0]),
    [KEYS.policyIndex]: JSON.stringify(['rule:0']),
    [KEYS.policy('rule:0')]: JSON.stringify(mockPolicy),
    [KEYS.policyEmbedding('rule:0')]: JSON.stringify([0.99, 0.1, 0]),
  };
  return {
    put: jest.fn(async (k: string, v: string) => { store[k] = v; }),
    get: jest.fn(async (k: string) => store[k] ?? undefined),
    delete: jest.fn(),
  };
};

describe('runRecommendationEngine', () => {
  it('processes all items and returns accurate summary counts', async () => {
    const kv = makeFullKv();
    const summary = await runRecommendationEngine(kv as any);
    expect(summary.processed).toBe(1);
    const total = summary.removed + summary.monitored + summary.approved + summary.escalated;
    expect(total).toBe(1);
  });

  it('persists a Recommendation for each processed item', async () => {
    const kv = makeFullKv();
    await runRecommendationEngine(kv as any);
    // Check recommendation was saved
    const rec = await kv.get(KEYS.recommendation('p1'));
    expect(rec).toBeDefined();
    const parsed = JSON.parse(rec as string);
    expect(parsed.itemId).toBe('p1');
    expect(parsed.suggestedAction).toBeDefined();
    expect(parsed.rationale).toBeDefined();
  });

  it('returns remove in summary for a high-similarity match', async () => {
    const kv = makeFullKv();
    const summary = await runRecommendationEngine(kv as any);
    // similarity ~0.995 >= 0.85 → remove
    expect(summary.removed).toBe(1);
    expect(summary.monitored).toBe(0);
    expect(summary.approved).toBe(0);
  });

  it('skips items with no stored embedding and does not count them as processed', async () => {
    const store: Record<string, string> = {
      [KEYS.modItemIndex]: JSON.stringify(['p1', 'p2']),
      [KEYS.modItem('p1')]: JSON.stringify(mockItem),
      [KEYS.embedding('p1')]: JSON.stringify([1, 0, 0]),
      [KEYS.modItem('p2')]: JSON.stringify({ ...mockItem, id: 'p2' }),
      // p2 has NO embedding stored
      [KEYS.policyIndex]: JSON.stringify(['rule:0']),
      [KEYS.policy('rule:0')]: JSON.stringify(mockPolicy),
      [KEYS.policyEmbedding('rule:0')]: JSON.stringify([0.99, 0.1, 0]),
    };
    const kv = {
      put: jest.fn(async (k: string, v: string) => { store[k] = v; }),
      get: jest.fn(async (k: string) => store[k] ?? undefined),
      delete: jest.fn(),
    };
    const summary = await runRecommendationEngine(kv as any);
    expect(summary.processed).toBe(1); // p2 skipped
  });

  it('returns all-zero summary when mod item index is empty', async () => {
    const store: Record<string, string> = {
      [KEYS.modItemIndex]: JSON.stringify([]),
    };
    const kv = {
      put: jest.fn(),
      get: jest.fn(async (k: string) => store[k] ?? undefined),
      delete: jest.fn(),
    };
    const summary = await runRecommendationEngine(kv as any);
    expect(summary.processed).toBe(0);
    expect(summary.removed).toBe(0);
    expect(summary.monitored).toBe(0);
    expect(summary.approved).toBe(0);
    expect(summary.escalated).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/arunish-shekhar/mod-app && npx jest tests/recommendations/engine.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '../../src/recommendations/engine'`

- [ ] **Step 3: Implement `engine.ts`**

```typescript
// src/recommendations/engine.ts
import type { KVStore } from '@devvit/public-api';
import { getAllModItemIds, getModItem } from '../storage/mod-item-store';
import { getEmbedding } from '../storage/embedding-store';
import { searchPolicies } from '../policy/searcher';
import { generateRecommendation } from './generator';
import { saveRecommendation } from '../storage/recommendation-store';

export interface RecommendationSummary {
  processed: number;
  removed: number;
  monitored: number;
  approved: number;
  escalated: number;
}

export async function runRecommendationEngine(kv: KVStore): Promise<RecommendationSummary> {
  const summary: RecommendationSummary = {
    processed: 0,
    removed: 0,
    monitored: 0,
    approved: 0,
    escalated: 0,
  };

  const ids = await getAllModItemIds(kv);

  for (const id of ids) {
    const item = await getModItem(kv, id);
    if (!item) continue;

    const vector = await getEmbedding(kv, id);
    if (!vector) {
      console.warn(`runRecommendationEngine: no embedding for item ${id}, skipping`);
      continue;
    }

    const matches = await searchPolicies(kv, vector, 3);
    const rec = generateRecommendation(item, matches);
    await saveRecommendation(kv, rec);

    summary.processed++;
    if (rec.suggestedAction === 'remove') summary.removed++;
    else if (rec.suggestedAction === 'monitor') summary.monitored++;
    else if (rec.suggestedAction === 'escalate') summary.escalated++;
    else summary.approved++;
  }

  return summary;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/arunish-shekhar/mod-app && npx jest tests/recommendations/engine.test.ts --no-coverage
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

```bash
cd /home/arunish-shekhar/mod-app && npm test
```

Expected: all existing tests plus the 3 new test files PASS. Zero failures.

- [ ] **Step 6: Commit**

```bash
git add src/recommendations/engine.ts tests/recommendations/engine.test.ts
git commit -m "feat: add runRecommendationEngine orchestrator"
```

---

## Task 6: Wire into `main.ts`

**Files:**
- Modify: `src/main.ts`

Three changes needed:
1. Import `runRecommendationEngine` from `./recommendations/engine`
2. Add a `recommendation-run` scheduler job (after the `policy-refresh` job)
3. Add an `AMIS: Analyze Queue` menu item (after the `AMIS: Refresh Policy` menu item)
4. Update the `AppInstall` trigger to also schedule `recommendation-run` (5-second delay)

No unit test for `main.ts` — the Devvit framework wires this at runtime. Verify via TypeScript compilation.

- [ ] **Step 1: Add the import at the top of `main.ts`**

The current imports are:
```typescript
import { Devvit } from '@devvit/public-api';
import { createEmbeddingClient } from './embeddings/client';
import { runQueueProcessor } from './jobs/queue-processor';
import { runHealthCheck } from './triggers/health-check';
import { runPolicyRefresh } from './triggers/policy-refresh';
```

Add `runRecommendationEngine`:
```typescript
import { Devvit } from '@devvit/public-api';
import { createEmbeddingClient } from './embeddings/client';
import { runQueueProcessor } from './jobs/queue-processor';
import { runHealthCheck } from './triggers/health-check';
import { runPolicyRefresh } from './triggers/policy-refresh';
import { runRecommendationEngine } from './recommendations/engine';
```

- [ ] **Step 2: Update the `AppInstall` trigger to schedule `recommendation-run`**

Replace the existing `AppInstall` trigger:
```typescript
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
  },
});
```

The 5-second delay gives `queue-processor` and `policy-refresh` time to populate KV before the engine runs on first install.

- [ ] **Step 3: Add the `recommendation-run` scheduler job after the `policy-refresh` job block**

Add this block immediately after the closing `});` of the `policy-refresh` scheduler job:

```typescript
Devvit.addSchedulerJob({
  name: 'recommendation-run',
  onRun: async (_event, context) => {
    if (!context.subredditName) {
      console.error('recommendation-run: subredditName unavailable in job context — skipping run');
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
```

- [ ] **Step 4: Add the `AMIS: Analyze Queue` menu item after the `AMIS: Refresh Policy` menu item block**

Add this block immediately after the closing `});` of the `AMIS: Refresh Policy` menu item:

```typescript
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
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /home/arunish-shekhar/mod-app && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 6: Run full test suite**

```bash
cd /home/arunish-shekhar/mod-app && npm test
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire recommendation-run job and AMIS: Analyze Queue menu item"
```

---

## Exit Criterion

Phase 3 is complete when:

1. `npm test` passes with all new tests green (no failures, no skipped)
2. `npx tsc --noEmit` reports no TypeScript errors
3. `src/main.ts` contains `recommendation-run` scheduler job and `AMIS: Analyze Queue` menu item
4. Manual trace: calling `generateRecommendation` with `similarity = 0.9` returns `suggestedAction: 'remove'`, `riskLevel: 'high'`, `confidenceScore: 98`, and a rationale containing the policy title

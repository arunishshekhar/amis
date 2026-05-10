# Phase 2 — Policy Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a subreddit-specific policy memory — ingest rules, AutoMod config, wiki pages, and removal reasons into a searchable `PolicyObject` store with Voyage AI embeddings and cosine similarity search.

**Architecture:** Four pure ingestor functions produce `PolicyObject[]` records; a shared embedder stores vectors under `policy_embedding:${id}` alongside existing `ModItem` embeddings; a cosine similarity searcher returns top-K matching policies for any query vector. An orchestrator drives the full refresh cycle and is wired to both `AppInstall` and a moderator menu item in `main.ts`.

**Tech Stack:** `@devvit/public-api`, `@devvit/protos` (transitive dep — already available), `voyageai`, `js-yaml`, TypeScript, Jest.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `package.json` | Modify | Add `js-yaml` and `@types/js-yaml` |
| `src/types/policy-object.ts` | Create | `PolicyObject` interface and `PolicySource` type |
| `src/storage/keys.ts` | Modify | Add `policy`, `policyIndex`, `policyEmbedding` key helpers |
| `src/storage/policy-store.ts` | Create | `savePolicy`, `getPolicy`, `getAllPolicies`, `clearPolicies` |
| `src/utils/cosine.ts` | Create | Pure cosine similarity math |
| `src/policy/rule-ingestor.ts` | Create | Subreddit rules → `PolicyObject[]` (pure, DI) |
| `src/policy/automod-parser.ts` | Create | AutoMod wiki YAML → `PolicyObject[]` |
| `src/policy/wiki-ingestor.ts` | Create | Wiki page chunks → `PolicyObject[]` |
| `src/policy/removal-reason-ingestor.ts` | Create | Removal reasons → `PolicyObject[]` |
| `src/policy/embedder.ts` | Create | Embed and store policy vectors, set `policyIndex` |
| `src/policy/searcher.ts` | Create | Cosine similarity search over policy store |
| `src/triggers/policy-refresh.ts` | Create | Orchestrate full ingestion cycle |
| `src/main.ts` | Modify | `WIKI_PAGES` setting, auto-refresh on install, menu item |
| `tests/storage/policy-store.test.ts` | Create | CRUD + clear round-trips |
| `tests/utils/cosine.test.ts` | Create | Math correctness |
| `tests/policy/rule-ingestor.test.ts` | Create | Rule mapping |
| `tests/policy/automod-parser.test.ts` | Create | YAML parsing, malformed tolerance |
| `tests/policy/wiki-ingestor.test.ts` | Create | Chunking, 404 skip |
| `tests/policy/removal-reason-ingestor.test.ts` | Create | Removal reason mapping |
| `tests/policy/embedder.test.ts` | Create | Vector storage and index write |
| `tests/policy/searcher.test.ts` | Create | Top-K selection, sorted by score |

---

## Task 1: Install `js-yaml`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

```bash
cd /home/arunish-shekhar/mod-app && npm install js-yaml && npm install --save-dev @types/js-yaml
```

Expected output: lines ending with `added N packages` (no errors).

- [ ] **Step 2: Verify the types resolve**

```bash
node -e "const yaml = require('js-yaml'); console.log(typeof yaml.load)"
```

Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add js-yaml for automod config parsing"
```

---

## Task 2: `PolicyObject` Type

**Files:**
- Create: `src/types/policy-object.ts`

- [ ] **Step 1: Create the type file**

```typescript
// src/types/policy-object.ts
export type PolicySource = 'rule' | 'automod' | 'wiki' | 'removal_reason';

export interface PolicyObject {
  id: string;
  source: PolicySource;
  title: string;
  text: string;
  metadata: Record<string, string>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/policy-object.ts
git commit -m "feat: add PolicyObject type"
```

---

## Task 3: Storage Keys + Policy Store CRUD

**Files:**
- Modify: `src/storage/keys.ts`
- Create: `src/storage/policy-store.ts`
- Create: `tests/storage/policy-store.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/storage/policy-store.test.ts
import {
  savePolicy,
  getPolicy,
  getAllPolicies,
  clearPolicies,
} from '../../src/storage/policy-store';
import { KEYS } from '../../src/storage/keys';
import type { PolicyObject } from '../../src/types/policy-object';

const mockPolicy: PolicyObject = {
  id: 'rule:0',
  source: 'rule',
  title: 'No spam',
  text: 'No spam: Do not post spam.',
  metadata: { priority: '0' },
};

const makeKv = () => {
  const store: Record<string, unknown> = {};
  return {
    put: jest.fn(async (k: string, v: unknown) => { store[k] = v; }),
    get: jest.fn(async (k: string) => store[k] ?? undefined),
    delete: jest.fn(async (k: string) => { delete store[k]; }),
  };
};

describe('savePolicy / getPolicy', () => {
  it('stores and retrieves a PolicyObject by id', async () => {
    const kv = makeKv();
    await savePolicy(kv as any, mockPolicy);
    expect(kv.put).toHaveBeenCalledWith(KEYS.policy('rule:0'), JSON.stringify(mockPolicy));
    const result = await getPolicy(kv as any, 'rule:0');
    expect(result).toEqual(mockPolicy);
  });

  it('returns null for an unknown id', async () => {
    const kv = makeKv();
    expect(await getPolicy(kv as any, 'nope')).toBeNull();
  });
});

describe('getAllPolicies', () => {
  it('returns all policies listed in policyIndex', async () => {
    const kv = makeKv();
    await kv.put(KEYS.policy('rule:0'), JSON.stringify(mockPolicy));
    await kv.put(KEYS.policyIndex, JSON.stringify(['rule:0']));
    const results = await getAllPolicies(kv as any);
    expect(results).toEqual([mockPolicy]);
  });

  it('returns empty array when index is missing', async () => {
    const kv = makeKv();
    expect(await getAllPolicies(kv as any)).toEqual([]);
  });
});

describe('clearPolicies', () => {
  it('deletes all policy, embedding, and index keys', async () => {
    const kv = makeKv();
    await kv.put(KEYS.policy('rule:0'), JSON.stringify(mockPolicy));
    await kv.put(KEYS.policyEmbedding('rule:0'), JSON.stringify([0.1, 0.2]));
    await kv.put(KEYS.policyIndex, JSON.stringify(['rule:0']));

    await clearPolicies(kv as any);

    expect(await kv.get(KEYS.policy('rule:0'))).toBeUndefined();
    expect(await kv.get(KEYS.policyEmbedding('rule:0'))).toBeUndefined();
    expect(await kv.get(KEYS.policyIndex)).toBeUndefined();
  });

  it('no-ops when index is missing', async () => {
    const kv = makeKv();
    await expect(clearPolicies(kv as any)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd /home/arunish-shekhar/mod-app && npm test -- tests/storage/policy-store.test.ts
```

Expected: FAIL — `Cannot find module '../../src/storage/policy-store'`

- [ ] **Step 3: Extend `keys.ts`**

Replace the existing content of `src/storage/keys.ts` with:

```typescript
// src/storage/keys.ts
export const KEYS = {
  modItem: (id: string) => `mod_item:${id}`,
  embedding: (id: string) => `embedding:${id}`,
  modItemIndex: 'mod_item_index',
  policy: (id: string) => `policy:${id}`,
  policyIndex: 'policy_index',
  policyEmbedding: (id: string) => `policy_embedding:${id}`,
};
```

- [ ] **Step 4: Create `policy-store.ts`**

```typescript
// src/storage/policy-store.ts
import type { KVStore } from '@devvit/public-api';
import { KEYS } from './keys';
import type { PolicyObject } from '../types/policy-object';

export async function savePolicy(kv: KVStore, policy: PolicyObject): Promise<void> {
  await kv.put(KEYS.policy(policy.id), JSON.stringify(policy));
}

export async function getPolicy(kv: KVStore, id: string): Promise<PolicyObject | null> {
  const raw = await kv.get(KEYS.policy(id));
  return raw ? JSON.parse(raw as string) : null;
}

export async function getAllPolicies(kv: KVStore): Promise<PolicyObject[]> {
  const raw = await kv.get(KEYS.policyIndex);
  if (!raw) return [];
  const ids: string[] = JSON.parse(raw as string);
  const results = await Promise.all(ids.map((id) => getPolicy(kv, id)));
  return results.filter((p): p is PolicyObject => p !== null);
}

export async function clearPolicies(kv: KVStore): Promise<void> {
  const raw = await kv.get(KEYS.policyIndex);
  if (!raw) return;
  const ids: string[] = JSON.parse(raw as string);
  await Promise.all([
    ...ids.map((id) => kv.delete(KEYS.policy(id))),
    ...ids.map((id) => kv.delete(KEYS.policyEmbedding(id))),
    kv.delete(KEYS.policyIndex),
  ]);
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
npm test -- tests/storage/policy-store.test.ts
```

Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add src/storage/keys.ts src/storage/policy-store.ts tests/storage/policy-store.test.ts
git commit -m "feat: add policy store CRUD and extend storage keys"
```

---

## Task 4: Cosine Similarity Utility

**Files:**
- Create: `src/utils/cosine.ts`
- Create: `tests/utils/cosine.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/utils/cosine.test.ts
import { cosineSimilarity } from '../../src/utils/cosine';

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
  });

  it('returns -1.0 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
  });

  it('returns 0 for zero vectors (avoids divide-by-zero)', () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npm test -- tests/utils/cosine.test.ts
```

Expected: FAIL — `Cannot find module '../../src/utils/cosine'`

- [ ] **Step 3: Implement `cosine.ts`**

```typescript
// src/utils/cosine.ts
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test -- tests/utils/cosine.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/cosine.ts tests/utils/cosine.test.ts
git commit -m "feat: add cosine similarity utility"
```

---

## Task 5: Rule Ingestor

**Files:**
- Create: `src/policy/rule-ingestor.ts`
- Create: `tests/policy/rule-ingestor.test.ts`

**Note:** The Devvit public API does not expose `getSubredditRules` on `RedditAPIClient`. Rules are fetched via `Devvit.redditAPIPlugins.Subreddits.SubredditAboutRules` (an `@internal` protobuf RPC used by the SDK's own Widget model). To keep this ingestor pure and testable, it takes a `getRules` callback — the orchestrator in Task 11 constructs that callback with the real Devvit plugin call.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/policy/rule-ingestor.test.ts
import { ingestRules } from '../../src/policy/rule-ingestor';
import type { SubredditRule } from '../../src/policy/rule-ingestor';

const makeGetRules = (rules: SubredditRule[]) =>
  jest.fn().mockResolvedValue(rules);

describe('ingestRules', () => {
  it('maps each rule to a PolicyObject', async () => {
    const getRules = makeGetRules([
      { shortName: 'No spam', description: 'Do not post spam.', priority: 0 },
      { shortName: 'Be civil', description: 'Treat others with respect.', priority: 1 },
    ]);

    const result = await ingestRules('testsubreddit', getRules);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: 'rule:0',
      source: 'rule',
      title: 'No spam',
      text: 'No spam: Do not post spam.',
      metadata: { priority: '0' },
    });
    expect(result[1]).toEqual({
      id: 'rule:1',
      source: 'rule',
      title: 'Be civil',
      text: 'Be civil: Treat others with respect.',
      metadata: { priority: '1' },
    });
  });

  it('falls back to "Rule N" title when shortName is missing', async () => {
    const getRules = makeGetRules([{ description: 'Some rule.' }]);
    const result = await ingestRules('testsubreddit', getRules);
    expect(result[0].title).toBe('Rule 1');
    expect(result[0].text).toBe('Rule 1: Some rule.');
  });

  it('returns empty array when no rules', async () => {
    const getRules = makeGetRules([]);
    const result = await ingestRules('testsubreddit', getRules);
    expect(result).toEqual([]);
  });

  it('passes subredditName to getRules', async () => {
    const getRules = makeGetRules([]);
    await ingestRules('mysubreddit', getRules);
    expect(getRules).toHaveBeenCalledWith('mysubreddit');
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npm test -- tests/policy/rule-ingestor.test.ts
```

Expected: FAIL — `Cannot find module '../../src/policy/rule-ingestor'`

- [ ] **Step 3: Implement `rule-ingestor.ts`**

```typescript
// src/policy/rule-ingestor.ts
import type { PolicyObject } from '../types/policy-object';

export type SubredditRule = {
  shortName?: string;
  description?: string;
  priority?: number;
};

export async function ingestRules(
  subredditName: string,
  getRules: (subredditName: string) => Promise<SubredditRule[]>
): Promise<PolicyObject[]> {
  const rules = await getRules(subredditName);
  return rules.map((rule, index): PolicyObject => {
    const title = rule.shortName ?? `Rule ${index + 1}`;
    return {
      id: `rule:${index}`,
      source: 'rule',
      title,
      text: `${title}: ${rule.description ?? ''}`.trim(),
      metadata: { priority: String(rule.priority ?? index) },
    };
  });
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test -- tests/policy/rule-ingestor.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/policy/rule-ingestor.ts tests/policy/rule-ingestor.test.ts
git commit -m "feat: add rule ingestor"
```

---

## Task 6: AutoMod YAML Parser

**Files:**
- Create: `src/policy/automod-parser.ts`
- Create: `tests/policy/automod-parser.test.ts`

**Note:** The automoderator config lives at `wiki/automoderator`. It is fetched via `reddit.getWikiPage(subredditName, 'automoderator')` which returns a `WikiPage` object with a `.content` string property. Each YAML block (separated by `---` on its own line) is one automod rule. Parsing is wrapped in try/catch per block so malformed entries are skipped.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/policy/automod-parser.test.ts
import { parseAutomodConfig } from '../../src/policy/automod-parser';

const makeReddit = (content: string | null) => ({
  getWikiPage: jest.fn().mockResolvedValue(
    content !== null ? { content } : Promise.reject(new Error('not found'))
  ),
});

const makeRedditThrowing = () => ({
  getWikiPage: jest.fn().mockRejectedValue(new Error('wiki page not found')),
});

describe('parseAutomodConfig', () => {
  it('converts each YAML block to a PolicyObject', async () => {
    const yaml = `action: remove\ntype: submission\nbody_text_contains: "spam"`;
    const reddit = makeReddit(yaml);

    const result = await parseAutomodConfig(reddit as any, 'testsubreddit');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'automod:0',
      source: 'automod',
      text: expect.stringContaining('action: remove'),
    });
  });

  it('handles multiple blocks separated by ---', async () => {
    const yaml = `action: remove\ntype: submission\n---\naction: report\ntype: comment`;
    const reddit = makeReddit(yaml);

    const result = await parseAutomodConfig(reddit as any, 'testsubreddit');
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('automod:0');
    expect(result[1].id).toBe('automod:1');
  });

  it('skips malformed blocks and continues', async () => {
    const yaml = `action: remove\n---\n: invalid: yaml: [\n---\naction: report`;
    const reddit = makeReddit(yaml);

    const result = await parseAutomodConfig(reddit as any, 'testsubreddit');
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((p) => p.source === 'automod')).toBe(true);
  });

  it('returns empty array when wiki page is not found', async () => {
    const reddit = makeRedditThrowing();
    const result = await parseAutomodConfig(reddit as any, 'testsubreddit');
    expect(result).toEqual([]);
  });

  it('returns empty array for blank config', async () => {
    const reddit = makeReddit('');
    const result = await parseAutomodConfig(reddit as any, 'testsubreddit');
    expect(result).toEqual([]);
  });

  it('uses the name field as title when present', async () => {
    const yaml = `name: anti-spam\naction: remove\nbody_text_contains: "buy now"`;
    const reddit = makeReddit(yaml);
    const result = await parseAutomodConfig(reddit as any, 'testsubreddit');
    expect(result[0].title).toBe('anti-spam');
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npm test -- tests/policy/automod-parser.test.ts
```

Expected: FAIL — `Cannot find module '../../src/policy/automod-parser'`

- [ ] **Step 3: Implement `automod-parser.ts`**

```typescript
// src/policy/automod-parser.ts
import type { RedditAPIClient } from '@devvit/public-api';
import * as yaml from 'js-yaml';
import type { PolicyObject } from '../types/policy-object';

const EXTRACTED_FIELDS = [
  'action', 'type', 'body_text_contains', 'title_text_contains',
  'author', 'url', 'domain', 'flair_text', 'flair_css_class',
];

export async function parseAutomodConfig(
  reddit: RedditAPIClient,
  subredditName: string
): Promise<PolicyObject[]> {
  let content: string;
  try {
    const page = await reddit.getWikiPage(subredditName, 'automoderator');
    content = page.content ?? '';
  } catch {
    console.warn('parseAutomodConfig: automoderator wiki page not found — skipping');
    return [];
  }

  const blocks = content.split(/^---$/m).map((b) => b.trim()).filter(Boolean);
  const policies: PolicyObject[] = [];

  for (let i = 0; i < blocks.length; i++) {
    try {
      const parsed = yaml.load(blocks[i]) as Record<string, unknown> | null;
      if (!parsed || typeof parsed !== 'object') continue;

      const extracted: Record<string, string> = {};
      for (const field of EXTRACTED_FIELDS) {
        if (parsed[field] !== undefined) {
          extracted[field] = String(parsed[field]);
        }
      }

      const text = Object.entries(extracted)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ') || `Automod rule ${i}`;

      const title = typeof parsed['name'] === 'string'
        ? parsed['name']
        : `Automod rule ${i}`;

      policies.push({ id: `automod:${i}`, source: 'automod', title, text, metadata: {} });
    } catch (err) {
      console.warn(`parseAutomodConfig: skipping malformed block ${i}:`, err);
    }
  }

  return policies;
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test -- tests/policy/automod-parser.test.ts
```

Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/policy/automod-parser.ts tests/policy/automod-parser.test.ts
git commit -m "feat: add automod YAML parser"
```

---

## Task 7: Wiki Ingestor

**Files:**
- Create: `src/policy/wiki-ingestor.ts`
- Create: `tests/policy/wiki-ingestor.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/policy/wiki-ingestor.test.ts
import { ingestWikiPages, chunkText } from '../../src/policy/wiki-ingestor';

describe('chunkText', () => {
  it('returns two chunks when combined paragraphs exceed maxChunkSize', () => {
    const para = 'A'.repeat(300);
    const text = `${para}\n\n${para}`;
    const chunks = chunkText(text, 500);
    // Each para is 300 chars; combined with separator is 602 > 500, so expect 2 chunks
    expect(chunks).toHaveLength(2);
  });

  it('content of two-chunk split matches original paragraphs', () => {
    const para = 'A'.repeat(300);
    const text = `${para}\n\n${para}`;
    const chunks = chunkText(text, 500);
    expect(chunks[0]).toBe(para);
    expect(chunks[1]).toBe(para);
  });

  it('returns one chunk when all paragraphs fit', () => {
    const text = 'Short para one.\n\nShort para two.';
    const chunks = chunkText(text, 500);
    expect(chunks).toHaveLength(1);
  });

  it('returns empty array for empty string', () => {
    expect(chunkText('', 500)).toEqual([]);
  });
});

describe('ingestWikiPages', () => {
  it('chunks a wiki page into PolicyObjects', async () => {
    const reddit = {
      getWikiPage: jest.fn().mockResolvedValue({ content: 'Hello\n\nWorld' }),
    };
    const result = await ingestWikiPages(reddit as any, 'testsubreddit', ['guidelines']);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].source).toBe('wiki');
    expect(result[0].id).toMatch(/^wiki:guidelines:/);
    expect(result[0].metadata).toEqual({ page: 'guidelines' });
  });

  it('skips pages that return an error', async () => {
    const reddit = {
      getWikiPage: jest.fn().mockRejectedValue(new Error('not found')),
    };
    const result = await ingestWikiPages(reddit as any, 'testsubreddit', ['missing-page']);
    expect(result).toEqual([]);
  });

  it('handles multiple pages', async () => {
    const reddit = {
      getWikiPage: jest.fn()
        .mockResolvedValueOnce({ content: 'Page one content' })
        .mockResolvedValueOnce({ content: 'Page two content' }),
    };
    const result = await ingestWikiPages(reddit as any, 'testsubreddit', ['p1', 'p2']);
    expect(result.some((p) => p.id.startsWith('wiki:p1:'))).toBe(true);
    expect(result.some((p) => p.id.startsWith('wiki:p2:'))).toBe(true);
  });

  it('returns empty array for empty page list', async () => {
    const reddit = { getWikiPage: jest.fn() };
    const result = await ingestWikiPages(reddit as any, 'testsubreddit', []);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npm test -- tests/policy/wiki-ingestor.test.ts
```

Expected: FAIL — `Cannot find module '../../src/policy/wiki-ingestor'`

- [ ] **Step 3: Implement `wiki-ingestor.ts`**

```typescript
// src/policy/wiki-ingestor.ts
import type { RedditAPIClient } from '@devvit/public-api';
import type { PolicyObject } from '../types/policy-object';

export function chunkText(text: string, maxChunkSize = 500): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length > maxChunkSize && current.length > 0) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

export async function ingestWikiPages(
  reddit: RedditAPIClient,
  subredditName: string,
  pageNames: string[]
): Promise<PolicyObject[]> {
  const policies: PolicyObject[] = [];

  for (const pageName of pageNames) {
    try {
      const page = await reddit.getWikiPage(subredditName, pageName.trim());
      const chunks = chunkText(page.content ?? '');
      for (let i = 0; i < chunks.length; i++) {
        policies.push({
          id: `wiki:${pageName}:${i}`,
          source: 'wiki',
          title: `${pageName}:${i}`,
          text: chunks[i],
          metadata: { page: pageName },
        });
      }
    } catch {
      console.warn(`ingestWikiPages: skipping page "${pageName}" — not accessible`);
    }
  }

  return policies;
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test -- tests/policy/wiki-ingestor.test.ts
```

Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/policy/wiki-ingestor.ts tests/policy/wiki-ingestor.test.ts
git commit -m "feat: add wiki page ingestor with paragraph chunking"
```

---

## Task 8: Removal Reason Ingestor

**Files:**
- Create: `src/policy/removal-reason-ingestor.ts`
- Create: `tests/policy/removal-reason-ingestor.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/policy/removal-reason-ingestor.test.ts
import { ingestRemovalReasons } from '../../src/policy/removal-reason-ingestor';

describe('ingestRemovalReasons', () => {
  it('maps removal reasons to PolicyObjects', async () => {
    const reddit = {
      getSubredditRemovalReasons: jest.fn().mockResolvedValue([
        { id: 'abc', title: 'Spam', message: 'This is spam.' },
        { id: 'def', title: 'Off-topic', message: 'Not related to this subreddit.' },
      ]),
    };

    const result = await ingestRemovalReasons(reddit as any, 'testsubreddit');

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: 'removal_reason:0',
      source: 'removal_reason',
      title: 'Spam',
      text: 'Spam: This is spam.',
      metadata: {},
    });
    expect(result[1]).toEqual({
      id: 'removal_reason:1',
      source: 'removal_reason',
      title: 'Off-topic',
      text: 'Off-topic: Not related to this subreddit.',
      metadata: {},
    });
  });

  it('returns empty array when there are no removal reasons', async () => {
    const reddit = {
      getSubredditRemovalReasons: jest.fn().mockResolvedValue([]),
    };
    const result = await ingestRemovalReasons(reddit as any, 'testsubreddit');
    expect(result).toEqual([]);
  });

  it('passes subredditName to the API', async () => {
    const reddit = {
      getSubredditRemovalReasons: jest.fn().mockResolvedValue([]),
    };
    await ingestRemovalReasons(reddit as any, 'mysubreddit');
    expect(reddit.getSubredditRemovalReasons).toHaveBeenCalledWith('mysubreddit');
  });

  it('falls back to "Removal reason N" title when title is missing', async () => {
    const reddit = {
      getSubredditRemovalReasons: jest.fn().mockResolvedValue([
        { id: 'xyz', message: 'Some message.' },
      ]),
    };
    const result = await ingestRemovalReasons(reddit as any, 'testsubreddit');
    expect(result[0].title).toBe('Removal reason 0');
    expect(result[0].text).toBe('Removal reason 0: Some message.');
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npm test -- tests/policy/removal-reason-ingestor.test.ts
```

Expected: FAIL — `Cannot find module '../../src/policy/removal-reason-ingestor'`

- [ ] **Step 3: Implement `removal-reason-ingestor.ts`**

```typescript
// src/policy/removal-reason-ingestor.ts
import type { RedditAPIClient } from '@devvit/public-api';
import type { PolicyObject } from '../types/policy-object';

export async function ingestRemovalReasons(
  reddit: RedditAPIClient,
  subredditName: string
): Promise<PolicyObject[]> {
  const reasons = await reddit.getSubredditRemovalReasons(subredditName);
  return reasons.map((reason, index): PolicyObject => {
    const title = reason.title ?? `Removal reason ${index}`;
    return {
      id: `removal_reason:${index}`,
      source: 'removal_reason',
      title,
      text: `${title}: ${reason.message ?? ''}`.trim(),
      metadata: {},
    };
  });
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test -- tests/policy/removal-reason-ingestor.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/policy/removal-reason-ingestor.ts tests/policy/removal-reason-ingestor.test.ts
git commit -m "feat: add removal reason ingestor"
```

---

## Task 9: Policy Embedder

**Files:**
- Create: `src/policy/embedder.ts`
- Create: `tests/policy/embedder.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/policy/embedder.test.ts
import { embedAndStorePolicies } from '../../src/policy/embedder';
import { KEYS } from '../../src/storage/keys';
import type { PolicyObject } from '../../src/types/policy-object';

const makeKv = () => {
  const store: Record<string, unknown> = {};
  return {
    put: jest.fn(async (k: string, v: unknown) => { store[k] = v; }),
    get: jest.fn(async (k: string) => store[k] ?? undefined),
  };
};

const policies: PolicyObject[] = [
  { id: 'rule:0', source: 'rule', title: 'No spam', text: 'No spam allowed', metadata: {} },
  { id: 'rule:1', source: 'rule', title: 'Be civil', text: 'Be nice', metadata: {} },
];

describe('embedAndStorePolicies', () => {
  it('embeds each policy with title: text format', async () => {
    const kv = makeKv();
    const mockEmbed = jest.fn()
      .mockResolvedValueOnce([0.1, 0.2])
      .mockResolvedValueOnce([0.3, 0.4]);
    const client = { embed: mockEmbed } as any;

    await embedAndStorePolicies(kv as any, client, policies);

    expect(mockEmbed).toHaveBeenCalledWith({
      model: 'voyage-3',
      input: ['No spam: No spam allowed'],
    });
    expect(mockEmbed).toHaveBeenCalledWith({
      model: 'voyage-3',
      input: ['Be civil: Be nice'],
    });
  });

  it('stores each embedding vector under the correct key', async () => {
    const kv = makeKv();
    const mockEmbed = jest.fn()
      .mockResolvedValueOnce([0.1, 0.2])
      .mockResolvedValueOnce([0.3, 0.4]);
    const client = { embed: mockEmbed } as any;

    await embedAndStorePolicies(kv as any, client, policies);

    expect(kv.put).toHaveBeenCalledWith(
      KEYS.policyEmbedding('rule:0'),
      JSON.stringify([0.1, 0.2])
    );
    expect(kv.put).toHaveBeenCalledWith(
      KEYS.policyEmbedding('rule:1'),
      JSON.stringify([0.3, 0.4])
    );
  });

  it('writes the policy index with all embedded ids', async () => {
    const kv = makeKv();
    const mockEmbed = jest.fn()
      .mockResolvedValueOnce([0.1, 0.2])
      .mockResolvedValueOnce([0.3, 0.4]);
    const client = { embed: mockEmbed } as any;

    await embedAndStorePolicies(kv as any, client, policies);

    expect(kv.put).toHaveBeenCalledWith(
      KEYS.policyIndex,
      JSON.stringify(['rule:0', 'rule:1'])
    );
  });

  it('handles an empty policy list without error', async () => {
    const kv = makeKv();
    const client = { embed: jest.fn() } as any;
    await expect(embedAndStorePolicies(kv as any, client, [])).resolves.toBeUndefined();
    expect(kv.put).toHaveBeenCalledWith(KEYS.policyIndex, JSON.stringify([]));
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npm test -- tests/policy/embedder.test.ts
```

Expected: FAIL — `Cannot find module '../../src/policy/embedder'`

- [ ] **Step 3: Implement `embedder.ts`**

```typescript
// src/policy/embedder.ts
import type { KVStore } from '@devvit/public-api';
import type { VoyageAIClient } from 'voyageai';
import type { PolicyObject } from '../types/policy-object';
import { embedText } from '../embeddings/client';
import { KEYS } from '../storage/keys';

export async function embedAndStorePolicies(
  kv: KVStore,
  client: VoyageAIClient,
  policies: PolicyObject[]
): Promise<void> {
  await Promise.all(
    policies.map(async (policy) => {
      const text = `${policy.title}: ${policy.text}`;
      const vector = await embedText(client, text);
      await kv.put(KEYS.policyEmbedding(policy.id), JSON.stringify(vector));
    })
  );
  await kv.put(KEYS.policyIndex, JSON.stringify(policies.map((p) => p.id)));
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test -- tests/policy/embedder.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/policy/embedder.ts tests/policy/embedder.test.ts
git commit -m "feat: add policy embedder"
```

---

## Task 10: Policy Searcher

**Files:**
- Create: `src/policy/searcher.ts`
- Create: `tests/policy/searcher.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/policy/searcher.test.ts
import { searchPolicies } from '../../src/policy/searcher';
import { KEYS } from '../../src/storage/keys';
import type { PolicyObject } from '../../src/types/policy-object';

const p1: PolicyObject = { id: 'rule:0', source: 'rule', title: 'No spam', text: 'No spam', metadata: {} };
const p2: PolicyObject = { id: 'rule:1', source: 'rule', title: 'Be civil', text: 'Be civil', metadata: {} };
const p3: PolicyObject = { id: 'rule:2', source: 'rule', title: 'No repost', text: 'No reposts', metadata: {} };

const makeKv = (policies: PolicyObject[], embeddings: Record<string, number[]>) => {
  const store: Record<string, string> = {
    [KEYS.policyIndex]: JSON.stringify(policies.map((p) => p.id)),
  };
  for (const p of policies) {
    store[KEYS.policy(p.id)] = JSON.stringify(p);
  }
  for (const [id, vec] of Object.entries(embeddings)) {
    store[KEYS.policyEmbedding(id)] = JSON.stringify(vec);
  }
  return {
    get: jest.fn(async (k: string) => store[k] ?? undefined),
    put: jest.fn(),
  };
};

describe('searchPolicies', () => {
  it('returns top-K results sorted by similarity descending', async () => {
    const kv = makeKv(
      [p1, p2, p3],
      {
        'rule:0': [1, 0, 0],
        'rule:1': [0, 1, 0],
        'rule:2': [0.9, 0.1, 0],
      }
    );

    // Query vector similar to rule:0
    const results = await searchPolicies(kv as any, [1, 0, 0], 2);

    expect(results).toHaveLength(2);
    expect(results[0].policy.id).toBe('rule:0');
    expect(results[0].similarity).toBeCloseTo(1.0);
    expect(results[1].policy.id).toBe('rule:2');
    expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
  });

  it('returns fewer than K results when fewer policies exist', async () => {
    const kv = makeKv([p1], { 'rule:0': [1, 0, 0] });
    const results = await searchPolicies(kv as any, [1, 0, 0], 5);
    expect(results).toHaveLength(1);
  });

  it('skips policies whose embeddings are missing', async () => {
    const kv = makeKv([p1, p2], { 'rule:0': [1, 0, 0] }); // p2 has no embedding
    const results = await searchPolicies(kv as any, [1, 0, 0], 3);
    expect(results).toHaveLength(1);
    expect(results[0].policy.id).toBe('rule:0');
  });

  it('returns empty array when policy store is empty', async () => {
    const kv = makeKv([], {});
    const results = await searchPolicies(kv as any, [1, 0, 0], 3);
    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npm test -- tests/policy/searcher.test.ts
```

Expected: FAIL — `Cannot find module '../../src/policy/searcher'`

- [ ] **Step 3: Implement `searcher.ts`**

```typescript
// src/policy/searcher.ts
import type { KVStore } from '@devvit/public-api';
import type { PolicyObject } from '../types/policy-object';
import { getAllPolicies } from '../storage/policy-store';
import { KEYS } from '../storage/keys';
import { cosineSimilarity } from '../utils/cosine';

export async function searchPolicies(
  kv: KVStore,
  queryVector: number[],
  topK = 3
): Promise<Array<{ policy: PolicyObject; similarity: number }>> {
  const policies = await getAllPolicies(kv);

  const scored = await Promise.all(
    policies.map(async (policy) => {
      const raw = await kv.get(KEYS.policyEmbedding(policy.id));
      if (!raw) return null;
      const vector: number[] = JSON.parse(raw as string);
      return { policy, similarity: cosineSimilarity(queryVector, vector) };
    })
  );

  return scored
    .filter((r): r is { policy: PolicyObject; similarity: number } => r !== null)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test -- tests/policy/searcher.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/policy/searcher.ts tests/policy/searcher.test.ts
git commit -m "feat: add policy semantic searcher"
```

---

## Task 11: Policy Refresh Orchestrator

**Files:**
- Create: `src/triggers/policy-refresh.ts`

**Note:** The rule ingestor uses `Devvit.redditAPIPlugins.Subreddits.SubredditAboutRules`. This is an `@internal` Devvit SDK call (same pattern used in `Widget.js`). It requires `context.metadata` from the Devvit scheduler/menu handler, passed into this orchestrator. No unit test is written for this orchestrator — it wires pure functions that are each fully tested.

- [ ] **Step 1: Create `policy-refresh.ts`**

```typescript
// src/triggers/policy-refresh.ts
import type { KVStore, RedditAPIClient } from '@devvit/public-api';
import { Devvit } from '@devvit/public-api';
import type { Metadata } from '@devvit/protos';
import type { VoyageAIClient } from 'voyageai';
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
  embeddingClient: VoyageAIClient,
  reddit: RedditAPIClient,
  metadata: Metadata,
  wikiPages: string[]
): Promise<PolicyRefreshResult> {
  const getRules = async (name: string) => {
    const rsp = await Devvit.redditAPIPlugins.Subreddits.SubredditAboutRules(
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

- [ ] **Step 2: Commit**

```bash
git add src/triggers/policy-refresh.ts
git commit -m "feat: add policy refresh orchestrator"
```

---

## Task 12: Wire into `main.ts`

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Replace `src/main.ts` with the updated version**

```typescript
// src/main.ts
import { Devvit } from '@devvit/public-api';
import { createEmbeddingClient } from './embeddings/client';
import { runQueueProcessor } from './jobs/queue-processor';
import { runHealthCheck } from './triggers/health-check';
import { runPolicyRefresh } from './triggers/policy-refresh';

Devvit.configure({
  kvStore: true,
  redditAPI: true,
  http: true,
});

Devvit.addSettings([
  {
    name: 'VOYAGE_API_KEY',
    label: 'Voyage AI API Key',
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
  },
});

Devvit.addSchedulerJob({
  name: 'queue-processor',
  onRun: async (_event, context) => {
    const apiKey = await context.settings.get<string>('VOYAGE_API_KEY');
    if (!apiKey) {
      console.error('runQueueProcessor: VOYAGE_API_KEY is not set — skipping run');
      return;
    }
    if (!context.subredditName) {
      console.error('runQueueProcessor: subredditName unavailable in job context — skipping run');
      return;
    }
    const embeddingClient = createEmbeddingClient(apiKey);
    await runQueueProcessor(
      context.subredditName,
      context.kvStore,
      embeddingClient,
      context.reddit
    );
  },
});

Devvit.addSchedulerJob({
  name: 'policy-refresh',
  onRun: async (_event, context) => {
    const apiKey = await context.settings.get<string>('VOYAGE_API_KEY');
    if (!apiKey) {
      console.error('policy-refresh: VOYAGE_API_KEY is not set — skipping run');
      return;
    }
    if (!context.subredditName) {
      console.error('policy-refresh: subredditName unavailable in job context — skipping run');
      return;
    }
    const wikiPagesRaw = await context.settings.get<string>('WIKI_PAGES') ?? '';
    const wikiPages = wikiPagesRaw.split(',').map((p) => p.trim()).filter(Boolean);
    const embeddingClient = createEmbeddingClient(apiKey);
    const result = await runPolicyRefresh(
      context.subredditName,
      context.kvStore,
      embeddingClient,
      context.reddit,
      context.metadata,
      wikiPages
    );
    console.log(
      `policy-refresh complete: ${result.rulesCount} rules, ` +
      `${result.automodCount} automod, ${result.wikiCount} wiki, ` +
      `${result.removalCount} removal reasons`
    );
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
    const apiKey = await context.settings.get<string>('VOYAGE_API_KEY');
    if (!apiKey) {
      context.ui.showToast('AMIS: VOYAGE_API_KEY not configured');
      return;
    }
    if (!context.subredditName) {
      context.ui.showToast('AMIS: subreddit name unavailable');
      return;
    }
    const wikiPagesRaw = await context.settings.get<string>('WIKI_PAGES') ?? '';
    const wikiPages = wikiPagesRaw.split(',').map((p) => p.trim()).filter(Boolean);
    const embeddingClient = createEmbeddingClient(apiKey);
    const result = await runPolicyRefresh(
      context.subredditName,
      context.kvStore,
      embeddingClient,
      context.reddit,
      context.metadata,
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

export default Devvit;
```

- [ ] **Step 2: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire policy refresh into main — auto on install + menu item"
```

---

## Task 13: Final Verification

- [ ] **Step 1: Run the full test suite**

```bash
cd /home/arunish-shekhar/mod-app && npm test
```

Expected output: all test suites pass with no failures. The summary should include:
- `tests/storage/mod-item-store.test.ts` — PASS
- `tests/storage/policy-store.test.ts` — PASS
- `tests/embeddings/client.test.ts` — PASS
- `tests/utils/cosine.test.ts` — PASS
- `tests/policy/rule-ingestor.test.ts` — PASS
- `tests/policy/automod-parser.test.ts` — PASS
- `tests/policy/wiki-ingestor.test.ts` — PASS
- `tests/policy/removal-reason-ingestor.test.ts` — PASS
- `tests/policy/embedder.test.ts` — PASS
- `tests/policy/searcher.test.ts` — PASS

- [ ] **Step 2: Run the TypeScript build**

```bash
npm run build
```

Expected: exits with code 0, no type errors.

- [ ] **Step 3: Confirm exit criterion**

Manually verify the search path works end-to-end by reading the searcher code against the test data — given a post body embedded to a vector, `searchPolicies(kv, queryVector, 3)` returns top-3 `PolicyObject` records with similarity scores. This is confirmed by the searcher test suite passing.

- [ ] **Step 4: Final commit (if any files were adjusted during verification)**

```bash
git add -p   # review any remaining changes
git commit -m "feat: Phase 2 Policy Intelligence — all tests passing"
```

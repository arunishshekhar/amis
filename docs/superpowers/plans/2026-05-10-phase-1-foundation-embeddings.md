# Phase 1: Foundation + Embeddings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Devvit app scaffold with a scheduled queue-fetch pipeline that normalizes moderation items and stores their embedding vectors in KV Store.

**Architecture:** A Devvit scheduled job runs the full pipeline: fetch modqueue → normalize to `ModItem` → generate embedding via Voyage AI → store both in KV Store. A moderator-only menu item triggers a health check that reports counts. All business logic lives in pure functions testable without the Devvit runtime.

**Tech Stack:** `@devvit/public-api`, `voyageai`, TypeScript, Jest.

---

## File Map

| File | Responsibility |
|---|---|
| `devvit.yaml` | App name, version, required Reddit permissions |
| `package.json` | Dependencies and npm scripts |
| `tsconfig.json` | TypeScript compiler config |
| `src/main.ts` | Devvit entry point — registers jobs and menu items |
| `src/types/mod-item.ts` | `ModItem` interface |
| `src/queue/fetcher.ts` | Calls Devvit Reddit API to fetch modqueue items |
| `src/queue/normalizer.ts` | Converts raw Devvit `Post`/`Comment` to `ModItem` |
| `src/embeddings/client.ts` | Voyage AI client wrapper (injectable for tests) |
| `src/embeddings/generator.ts` | Generates embeddings for a `ModItem` list |
| `src/storage/keys.ts` | KV Store key schema constants |
| `src/storage/mod-item-store.ts` | CRUD for `ModItem` records in KV Store |
| `src/storage/embedding-store.ts` | CRUD for embedding vectors in KV Store |
| `src/jobs/queue-processor.ts` | Scheduled job: fetch → normalize → embed → store |
| `src/triggers/health-check.ts` | Menu item handler: report item + embedding counts |
| `tests/queue/normalizer.test.ts` | Unit tests for normalizer |
| `tests/embeddings/client.test.ts` | Unit tests for Voyage AI client wrapper |
| `tests/storage/mod-item-store.test.ts` | Unit tests for KV Store operations |
| `tests/jobs/queue-processor.test.ts` | Integration test for the full pipeline |

---

## Task 1: Scaffold the Devvit App

**Files:**
- Create: `devvit.yaml`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/main.ts`

- [ ] **Step 1: Create `devvit.yaml`**

```yaml
name: amis
version: 0.0.1
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "amis",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "build": "devvit build",
    "test": "jest --passWithNoTests",
    "test:watch": "jest --watch"
  },
  "dependencies": {
    "@devvit/public-api": "0.11.x",
    "voyageai": "^0.0.5"
  },
  "devDependencies": {
    "@types/jest": "^29.0.0",
    "@types/node": "^20.0.0",
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Create `src/main.ts` (empty shell — will be filled in Task 8)**

```typescript
import { Devvit } from '@devvit/public-api';

Devvit.configure({
  kvStore: true,
  redditAPI: true,
});

export default Devvit;
```

- [ ] **Step 5: Install dependencies**

```bash
npm install
```

Expected: `node_modules` populated, no errors.

- [ ] **Step 6: Commit**

```bash
git init
git add devvit.yaml package.json tsconfig.json src/main.ts
git commit -m "chore: scaffold Devvit app"
```

---

## Task 2: Define the ModItem Type

**Files:**
- Create: `src/types/mod-item.ts`

- [ ] **Step 1: Write the type**

```typescript
export type ContentType = 'post' | 'comment';

export interface ModItem {
  id: string;
  author: string;
  timestamp: number; // Unix ms
  title: string;     // empty string for comments
  body: string;
  reportReasons: string[];
  contentType: ContentType;
  subredditId: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/mod-item.ts
git commit -m "feat: add ModItem type"
```

---

## Task 3: Build the Queue Normalizer

**Files:**
- Create: `src/queue/normalizer.ts`
- Create: `tests/queue/normalizer.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/queue/normalizer.test.ts
import { normalizePost, normalizeComment } from '../../src/queue/normalizer';

const BASE = {
  id: 'abc123',
  authorName: 'user1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  subredditId: 't5_xyz',
};

describe('normalizePost', () => {
  it('maps fields to ModItem shape', () => {
    const raw = {
      ...BASE,
      title: 'My Post',
      body: 'Post body',
      reports: [{ reason: 'spam' }, { reason: 'harassment' }],
    };
    const result = normalizePost(raw as any);
    expect(result).toEqual({
      id: 'abc123',
      author: 'user1',
      timestamp: new Date('2026-01-01T00:00:00Z').getTime(),
      title: 'My Post',
      body: 'Post body',
      reportReasons: ['spam', 'harassment'],
      contentType: 'post',
      subredditId: 't5_xyz',
    });
  });

  it('uses empty string when body is undefined', () => {
    const raw = { ...BASE, title: 'T', body: undefined, reports: [] };
    expect(normalizePost(raw as any).body).toBe('');
  });
});

describe('normalizeComment', () => {
  it('maps fields to ModItem shape with empty title', () => {
    const raw = { ...BASE, body: 'A comment', reports: [] };
    const result = normalizeComment(raw as any);
    expect(result.title).toBe('');
    expect(result.contentType).toBe('comment');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest tests/queue/normalizer.test.ts --no-coverage
```

Expected: FAIL — `normalizePost` not found.

- [ ] **Step 3: Implement the normalizer**

```typescript
// src/queue/normalizer.ts
import type { Post, Comment } from '@devvit/public-api';
import type { ModItem } from '../types/mod-item';

export function normalizePost(post: Post): ModItem {
  return {
    id: post.id,
    author: post.authorName ?? '',
    timestamp: post.createdAt.getTime(),
    title: post.title,
    body: post.body ?? '',
    reportReasons: (post.reports ?? []).map((r) => r.reason),
    contentType: 'post',
    subredditId: post.subredditId,
  };
}

export function normalizeComment(comment: Comment): ModItem {
  return {
    id: comment.id,
    author: comment.authorName ?? '',
    timestamp: comment.createdAt.getTime(),
    title: '',
    body: comment.body ?? '',
    reportReasons: (comment.reports ?? []).map((r) => r.reason),
    contentType: 'comment',
    subredditId: comment.subredditId,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest tests/queue/normalizer.test.ts --no-coverage
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/queue/normalizer.ts tests/queue/normalizer.test.ts
git commit -m "feat: add queue normalizer with tests"
```

---

## Task 4: Build the Queue Fetcher

**Files:**
- Create: `src/queue/fetcher.ts`

No unit tests here — this file is a thin wrapper around the Devvit Reddit API. The integration test in Task 8 covers it via a mock.

- [ ] **Step 1: Implement the fetcher**

```typescript
// src/queue/fetcher.ts
import type { RedditAPIClient } from '@devvit/public-api';
import { normalizePost, normalizeComment } from './normalizer';
import type { ModItem } from '../types/mod-item';

export async function fetchModQueue(
  reddit: RedditAPIClient,
  subredditName: string,
  limit = 100
): Promise<ModItem[]> {
  const items: ModItem[] = [];
  const listing = await reddit.getModQueue({ subredditName, limit });
  for await (const item of listing) {
    if (item.type === 'post') {
      items.push(normalizePost(item as any));
    } else if (item.type === 'comment') {
      items.push(normalizeComment(item as any));
    }
  }
  return items;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/queue/fetcher.ts
git commit -m "feat: add queue fetcher"
```

---

## Task 5: Build the KV Store Layer

**Files:**
- Create: `src/storage/keys.ts`
- Create: `src/storage/mod-item-store.ts`
- Create: `src/storage/embedding-store.ts`
- Create: `tests/storage/mod-item-store.test.ts`

- [ ] **Step 1: Write the key schema**

```typescript
// src/storage/keys.ts
export const KEYS = {
  modItem: (id: string) => `mod_item:${id}`,
  embedding: (id: string) => `embedding:${id}`,
  modItemIndex: 'mod_item_index', // JSON array of IDs
};
```

- [ ] **Step 2: Write failing tests for ModItem store**

```typescript
// tests/storage/mod-item-store.test.ts
import { saveModItems, getAllModItemIds, getModItem } from '../../src/storage/mod-item-store';
import { KEYS } from '../../src/storage/keys';
import type { ModItem } from '../../src/types/mod-item';

const mockItem: ModItem = {
  id: 'item1',
  author: 'u1',
  timestamp: 1000,
  title: 'T',
  body: 'B',
  reportReasons: ['spam'],
  contentType: 'post',
  subredditId: 's1',
};

const makeKv = () => {
  const store: Record<string, string> = {};
  return {
    put: jest.fn(async (k: string, v: string) => { store[k] = v; }),
    get: jest.fn(async (k: string) => store[k] ?? undefined),
  };
};

describe('saveModItems', () => {
  it('persists each item and updates the index', async () => {
    const kv = makeKv();
    await saveModItems(kv as any, [mockItem]);
    expect(kv.put).toHaveBeenCalledWith(KEYS.modItem('item1'), JSON.stringify(mockItem));
    expect(kv.put).toHaveBeenCalledWith(KEYS.modItemIndex, JSON.stringify(['item1']));
  });
});

describe('getAllModItemIds', () => {
  it('returns empty array when index missing', async () => {
    const kv = makeKv();
    expect(await getAllModItemIds(kv as any)).toEqual([]);
  });
});

describe('getModItem', () => {
  it('returns the stored item', async () => {
    const kv = makeKv();
    await saveModItems(kv as any, [mockItem]);
    const result = await getModItem(kv as any, 'item1');
    expect(result).toEqual(mockItem);
  });

  it('returns null for unknown id', async () => {
    const kv = makeKv();
    expect(await getModItem(kv as any, 'nope')).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx jest tests/storage/mod-item-store.test.ts --no-coverage
```

Expected: FAIL — `saveModItems` not found.

- [ ] **Step 4: Implement ModItem store**

```typescript
// src/storage/mod-item-store.ts
import type { KVStore } from '@devvit/public-api';
import { KEYS } from './keys';
import type { ModItem } from '../types/mod-item';

export async function saveModItems(kv: KVStore, items: ModItem[]): Promise<void> {
  const existingRaw = await kv.get(KEYS.modItemIndex);
  const existing: string[] = existingRaw ? JSON.parse(existingRaw) : [];
  const newIds = items.map((i) => i.id);
  const merged = Array.from(new Set([...existing, ...newIds]));
  await Promise.all(items.map((item) => kv.put(KEYS.modItem(item.id), JSON.stringify(item))));
  await kv.put(KEYS.modItemIndex, JSON.stringify(merged));
}

export async function getAllModItemIds(kv: KVStore): Promise<string[]> {
  const raw = await kv.get(KEYS.modItemIndex);
  return raw ? JSON.parse(raw) : [];
}

export async function getModItem(kv: KVStore, id: string): Promise<ModItem | null> {
  const raw = await kv.get(KEYS.modItem(id));
  return raw ? JSON.parse(raw) : null;
}
```

- [ ] **Step 5: Implement embedding store**

```typescript
// src/storage/embedding-store.ts
import type { KVStore } from '@devvit/public-api';
import { KEYS } from './keys';

export async function saveEmbedding(kv: KVStore, id: string, vector: number[]): Promise<void> {
  await kv.put(KEYS.embedding(id), JSON.stringify(vector));
}

export async function getEmbedding(kv: KVStore, id: string): Promise<number[] | null> {
  const raw = await kv.get(KEYS.embedding(id));
  return raw ? JSON.parse(raw) : null;
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx jest tests/storage/mod-item-store.test.ts --no-coverage
```

Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add src/storage/ tests/storage/mod-item-store.test.ts
git commit -m "feat: add KV Store layer for ModItems and embeddings"
```

---

## Task 6: Build the Voyage AI Embedding Client

**Files:**
- Create: `src/embeddings/client.ts`
- Create: `tests/embeddings/client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/embeddings/client.test.ts
import { createEmbeddingClient, embedText } from '../../src/embeddings/client';

describe('embedText', () => {
  it('calls Voyage AI and returns a float array', async () => {
    const mockEmbed = jest.fn().mockResolvedValue({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
    });
    const client = { embed: mockEmbed } as any;

    const result = await embedText(client, 'hello world');

    expect(mockEmbed).toHaveBeenCalledWith({
      model: 'voyage-3',
      input: ['hello world'],
    });
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/embeddings/client.test.ts --no-coverage
```

Expected: FAIL — `embedText` not found.

- [ ] **Step 3: Implement the client**

```typescript
// src/embeddings/client.ts
import { VoyageAIClient } from 'voyageai';

export function createEmbeddingClient(apiKey: string): VoyageAIClient {
  return new VoyageAIClient({ apiKey });
}

export async function embedText(client: VoyageAIClient, text: string): Promise<number[]> {
  const result = await client.embed({ model: 'voyage-3', input: [text] });
  return result.data[0].embedding;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/embeddings/client.test.ts --no-coverage
```

Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/embeddings/client.ts tests/embeddings/client.test.ts
git commit -m "feat: add Voyage AI embedding client with test"
```

---

## Task 7: Build the Embedding Generator

**Files:**
- Create: `src/embeddings/generator.ts`

Produces the text to embed from a `ModItem` and coordinates with the embedding client and store. No additional unit test — covered by the pipeline integration test in Task 8.

- [ ] **Step 1: Implement the generator**

```typescript
// src/embeddings/generator.ts
import type { KVStore } from '@devvit/public-api';
import type { VoyageAIClient } from 'voyageai';
import type { ModItem } from '../types/mod-item';
import { embedText } from './client';
import { saveEmbedding } from '../storage/embedding-store';

function itemToEmbedInput(item: ModItem): string {
  const parts = [item.title, item.body, ...item.reportReasons].filter(Boolean);
  return parts.join(' | ');
}

export async function generateAndStoreEmbeddings(
  kv: KVStore,
  client: VoyageAIClient,
  items: ModItem[]
): Promise<void> {
  await Promise.all(
    items.map(async (item) => {
      const text = itemToEmbedInput(item);
      const vector = await embedText(client, text);
      await saveEmbedding(kv, item.id, vector);
    })
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/embeddings/generator.ts
git commit -m "feat: add embedding generator"
```

---

## Task 8: Build the Queue Processor Job + Integration Test

**Files:**
- Create: `src/jobs/queue-processor.ts`
- Create: `tests/jobs/queue-processor.test.ts`

- [ ] **Step 1: Write the failing integration test**

```typescript
// tests/jobs/queue-processor.test.ts
import { runQueueProcessor } from '../../src/jobs/queue-processor';
import type { ModItem } from '../../src/types/mod-item';

const mockItem: ModItem = {
  id: 'p1',
  author: 'alice',
  timestamp: 1000,
  title: 'Test Post',
  body: 'Some content',
  reportReasons: ['spam'],
  contentType: 'post',
  subredditId: 't5_abc',
};

const store: Record<string, string> = {};
const mockKv = {
  put: jest.fn(async (k: string, v: string) => { store[k] = v; }),
  get: jest.fn(async (k: string) => store[k] ?? undefined),
};

const mockReddit = {
  currentSubreddit: jest.fn().mockResolvedValue({ name: 'testsubreddit' }),
  getModQueue: jest.fn().mockReturnValue({
    [Symbol.asyncIterator]: async function* () {
      yield { ...mockItem, type: 'post', authorName: 'alice', createdAt: new Date(1000), reports: [{ reason: 'spam' }] };
    },
  }),
};

const mockEmbeddingClient = {
  embed: jest.fn().mockResolvedValue({ data: [{ embedding: [0.1, 0.2] }] }),
};

describe('runQueueProcessor', () => {
  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    jest.clearAllMocks();
  });

  it('fetches queue, normalizes, embeds, and stores', async () => {
    await runQueueProcessor(
      mockReddit as any,
      mockKv as any,
      mockEmbeddingClient as any
    );

    expect(mockReddit.getModQueue).toHaveBeenCalledWith({ subredditName: 'testsubreddit', limit: 100 });
    expect(mockEmbeddingClient.embed).toHaveBeenCalledTimes(1);
    expect(mockKv.put).toHaveBeenCalledWith('mod_item:p1', expect.any(String));
    expect(mockKv.put).toHaveBeenCalledWith('embedding:p1', expect.any(String));
    expect(mockKv.put).toHaveBeenCalledWith('mod_item_index', JSON.stringify(['p1']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/jobs/queue-processor.test.ts --no-coverage
```

Expected: FAIL — `runQueueProcessor` not found.

- [ ] **Step 3: Implement the queue processor**

```typescript
// src/jobs/queue-processor.ts
import type { RedditAPIClient, KVStore } from '@devvit/public-api';
import type { VoyageAIClient } from 'voyageai';
import { fetchModQueue } from '../queue/fetcher';
import { saveModItems } from '../storage/mod-item-store';
import { generateAndStoreEmbeddings } from '../embeddings/generator';

export async function runQueueProcessor(
  reddit: RedditAPIClient,
  kv: KVStore,
  embeddingClient: VoyageAIClient
): Promise<void> {
  const subreddit = await reddit.currentSubreddit();
  const items = await fetchModQueue(reddit, subreddit.name);
  await saveModItems(kv, items);
  await generateAndStoreEmbeddings(kv, embeddingClient, items);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/jobs/queue-processor.test.ts --no-coverage
```

Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/jobs/queue-processor.ts tests/jobs/queue-processor.test.ts
git commit -m "feat: add queue processor job with integration test"
```

---

## Task 9: Build the Health Check Trigger

**Files:**
- Create: `src/triggers/health-check.ts`

- [ ] **Step 1: Implement the handler**

```typescript
// src/triggers/health-check.ts
import type { KVStore, UIClient } from '@devvit/public-api';
import { getAllModItemIds } from '../storage/mod-item-store';
import { getEmbedding } from '../storage/embedding-store';

export async function runHealthCheck(kv: KVStore, ui: UIClient): Promise<void> {
  const ids = await getAllModItemIds(kv);
  let embeddingCount = 0;
  for (const id of ids) {
    const vec = await getEmbedding(kv, id);
    if (vec) embeddingCount++;
  }
  ui.showToast(`AMIS: ${ids.length} items fetched, ${embeddingCount} embeddings stored`);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/triggers/health-check.ts
git commit -m "feat: add health check trigger"
```

---

## Task 10: Wire Everything into main.ts

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Update `src/main.ts` to register the job and menu item**

```typescript
import { Devvit } from '@devvit/public-api';
import { createEmbeddingClient } from './embeddings/client';
import { runQueueProcessor } from './jobs/queue-processor';
import { runHealthCheck } from './triggers/health-check';

Devvit.configure({
  kvStore: true,
  redditAPI: true,
});

Devvit.addSchedulerJob({
  name: 'queue-processor',
  onRun: async (_event, context) => {
    const embeddingClient = createEmbeddingClient(context.settings.get('VOYAGE_API_KEY') as string);
    await runQueueProcessor(context.reddit, context.kvStore, embeddingClient);
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

export default Devvit;
```

- [ ] **Step 2: Run all tests to confirm nothing broke**

```bash
npm test
```

Expected: All tests PASS.

- [ ] **Step 3: Build the app**

```bash
npm run build
```

Expected: No TypeScript errors, `dist/` populated.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire queue processor and health check into Devvit app"
```

---

## Task 11: Verify Exit Criterion

- [ ] **Step 1: Install the app on a test subreddit**

```bash
devvit upload
devvit playtest r/your-test-subreddit
```

Expected: App installs without errors.

- [ ] **Step 2: Set the VOYAGE_API_KEY app setting**

In the Devvit developer portal, add `VOYAGE_API_KEY` as an app setting with your Voyage AI API key from https://www.voyageai.com/.

- [ ] **Step 3: Manually trigger the job**

Via Reddit: navigate to the subreddit → Mod Tools → trigger the scheduled job via Devvit's dev console, or use the CLI:

```bash
devvit exec queue-processor
```

- [ ] **Step 4: Run health check**

On the subreddit, open the community menu → click "AMIS: Health Check".

Expected toast: `AMIS: N items fetched, N embeddings stored` where N ≥ 10.

**Phase 1 exit criterion is met when N ≥ 10.**

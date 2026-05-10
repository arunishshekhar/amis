# Phase 2 — Policy Intelligence Design

**Date:** 2026-05-10
**Status:** Approved
**Depends on:** Phase 1 (KV Store + Voyage AI embedding infrastructure)
**Unlocks:** Phase 3 (Recommendations Engine)

---

## Goal

Build a subreddit-specific policy memory. The app ingests subreddit rules, AutoModerator config, moderator wiki pages, and removal reasons, converts them into a searchable `PolicyObject` store with Voyage AI embeddings, and exposes semantic rule search. Every recommendation in Phase 3 will be grounded in THIS subreddit's policy — not a generic classifier.

---

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Storage architecture | Flat `PolicyObject` store | Follows Phase 1 pattern; `source` field gives Phase 3 filtering |
| AutoMod YAML parsing | `js-yaml` dependency | Full parsing, tolerant per-block with try/catch, maintainable |
| Wiki page selection | Configurable via app settings | Works for any subreddit structure; mods choose their own pages |
| Policy refresh trigger | Auto on install + manual menu item | System ready out of the box; mods refresh after rule changes |

---

## Types

### `PolicyObject` (`src/types/policy-object.ts`)

```typescript
export type PolicySource = 'rule' | 'automod' | 'wiki' | 'removal_reason';

export interface PolicyObject {
  id: string;           // e.g. "rule:0", "automod:12", "wiki:guidelines:0"
  source: PolicySource;
  title: string;        // rule name / automod section / wiki page+heading / removal reason name
  text: string;         // plain-language description used for embedding
  metadata: Record<string, string>; // e.g. { severity: 'high', category: 'spam' }
}
```

---

## Storage Schema

Extends `src/storage/keys.ts`:

```
policy:${id}            → PolicyObject (JSON)
policy_index            → JSON array of all policy IDs
policy_embedding:${id}  → number[] vector (JSON)
```

New `src/storage/policy-store.ts`: `savePolicy`, `getPolicy`, `getAllPolicies`, `clearPolicies` — mirrors `mod-item-store.ts` shape.

---

## Ingestion Pipeline

All ingestors are pure functions: `(reddit: RedditAPIClient, subredditName: string) => Promise<PolicyObject[]>`. No Devvit runtime dependency — all unit-testable.

### Rule Ingestor (`src/policy/rule-ingestor.ts`)

Calls `reddit.getSubredditRules(subredditName)`. Maps each rule to a `PolicyObject`:
- `source: 'rule'`
- `title`: rule short name
- `text`: `${name}: ${description}`
- `metadata`: `{ priority: String(index) }`

### AutoMod Parser (`src/policy/automod-parser.ts`)

Fetches the `wiki/automoderator` wiki page. Splits YAML into top-level document blocks (separated by `---`). Parses each block with `js-yaml`. Per-block try/catch: malformed entries are `console.warn`-logged and skipped. Each valid block becomes one `PolicyObject`:
- `source: 'automod'`
- `title`: automod block index or extracted `name` field
- `text`: stringified extracted fields (`action`, `type`, `body_text_contains`, `author`, etc.)
- No raw YAML stored.

### Wiki Ingestor (`src/policy/wiki-ingestor.ts`)

Reads the `WIKI_PAGES` app setting (comma-separated page names). Fetches each page via `reddit.getWikiPage()`. Pages that return 404/error are skipped silently. Content is split into ~500-character chunks (on paragraph/newline boundaries where possible). Each chunk becomes one `PolicyObject`:
- `source: 'wiki'`
- `title`: `${pageName}:${chunkIndex}`
- `text`: chunk content

### Removal Reason Ingestor (`src/policy/removal-reason-ingestor.ts`)

Calls `reddit.getRemovalReasons(subredditName)`. Maps each reason:
- `source: 'removal_reason'`
- `title`: reason title
- `text`: `${title}: ${message}`

---

## Embedding Generation (`src/policy/embedder.ts`)

Mirrors `src/embeddings/generator.ts`. Input: `KVStore`, Voyage AI client, `PolicyObject[]`. Embeds `${policy.title}: ${policy.text}` per object using the existing `embedText` function. Stores vectors under `policy_embedding:${id}`. Updates `policy_index`.

---

## Semantic Search (`src/policy/searcher.ts`)

```typescript
export async function searchPolicies(
  kv: KVStore,
  queryVector: number[],
  topK = 3
): Promise<Array<{ policy: PolicyObject; similarity: number }>>
```

Loads all policies from the index, fetches stored embedding vectors, computes cosine similarity against `queryVector`, returns top-K sorted descending by score.

Cosine similarity helper lives in `src/utils/cosine.ts` as a pure standalone function.

---

## Policy Refresh Orchestrator (`src/triggers/policy-refresh.ts`)

```typescript
export async function runPolicyRefresh(
  subredditName: string,
  kv: KVStore,
  embeddingClient: VoyageAIClient,
  reddit: RedditAPIClient,
  wikiPages: string[]
): Promise<{ rulesCount: number; automodCount: number; wikiCount: number; removalCount: number }>
```

Steps:
1. Run all four ingestors in parallel
2. `clearPolicies(kv)` — wipe old store (brief empty window is acceptable at MVP scale)
3. Save all new `PolicyObject` records
4. Run embedder over all new records
5. Return counts per source

---

## Main.ts Changes

1. Add `WIKI_PAGES` app setting: string, not secret, app scope, label `"Wiki pages to ingest (comma-separated)"`
2. In `AppInstall` trigger: schedule a one-shot `policy-refresh` job immediately after queue setup
3. Add `AMIS: Refresh Policy` moderator menu item → calls `runPolicyRefresh`, shows toast: `"Policy refreshed: X rules, X automod patterns, X wiki chunks, X removal reasons"`
4. Add `policy-refresh` scheduler job definition

---

## File Map

| File | Responsibility |
|---|---|
| `src/types/policy-object.ts` | `PolicyObject` interface and `PolicySource` type |
| `src/policy/rule-ingestor.ts` | Parse subreddit rules API → `PolicyObject[]` |
| `src/policy/automod-parser.ts` | Parse automod YAML → `PolicyObject[]` |
| `src/policy/wiki-ingestor.ts` | Fetch and chunk wiki pages → `PolicyObject[]` |
| `src/policy/removal-reason-ingestor.ts` | Parse removal reasons → `PolicyObject[]` |
| `src/policy/embedder.ts` | Embed and store `PolicyObject[]` vectors |
| `src/policy/searcher.ts` | Cosine similarity search over policy store |
| `src/utils/cosine.ts` | Pure cosine similarity math helper |
| `src/storage/policy-store.ts` | CRUD for `PolicyObject` in KV Store |
| `src/storage/keys.ts` | Extended with `policy`, `policyIndex`, `policyEmbedding` keys |
| `src/triggers/policy-refresh.ts` | Full ingestion orchestrator |
| `src/main.ts` | WIKI_PAGES setting + AppInstall trigger + Refresh Policy menu item |
| `tests/policy/rule-ingestor.test.ts` | Unit tests for rule mapping |
| `tests/policy/automod-parser.test.ts` | Unit tests: valid YAML, malformed blocks, empty config |
| `tests/policy/wiki-ingestor.test.ts` | Unit tests: chunking, 404 skip |
| `tests/policy/removal-reason-ingestor.test.ts` | Unit tests for removal reason mapping |
| `tests/utils/cosine.test.ts` | Pure math: identical=1.0, orthogonal=0.0 |
| `tests/policy/searcher.test.ts` | Top-K selection, sorted by score |
| `tests/storage/policy-store.test.ts` | save/get/clear round-trips with KV mock |

---

## Exit Criterion

Given a sample post body:
1. Embed it with the Voyage AI client
2. Call `searchPolicies(kv, queryVector, 3)`
3. Returns top-3 `PolicyObject` records with similarity scores > 0

Verified manually via dev console on a live subreddit with API keys configured.

---

## Constraints

- Policy embeddings regenerated only on "refresh policy" trigger — never during queue runs
- AutoMod parser: per-block try/catch, malformed entries logged and skipped
- No raw wiki content or raw YAML stored beyond extracted structured fields
- `clearPolicies` runs before each refresh — policy store always reflects current subreddit state

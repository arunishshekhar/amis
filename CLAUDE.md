# CLAUDE.md

This file provides guidance to AI coding assistants when working with code in this repository.

## Project Overview

**AI Moderation Intelligence System (AMIS)** — a Devvit-native Reddit app. It is NOT a moderation bot. It is a semantic moderation intelligence platform: AI provides real-time queue analysis, rule-aware suggestions, and consistency insights, while human moderators retain full control over all decisions.

The full original spec lives in `AI_Moderation_Intelligence_System_Advanced_Plan.md`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Platform | [Devvit](https://developers.reddit.com/docs) (Reddit's serverless developer platform) |
| Language | TypeScript (strict mode) |
| AI Providers | OpenAI, Google Gemini, Anthropic Claude, custom OpenAI-compatible |
| Embeddings | OpenAI `text-embedding-3-small`, Google `gemini-embedding-001`, VoyageAI |
| Storage | Devvit KV Store (Redis-like key-value, no SQL available) |
| Scheduling | Devvit Scheduler (cron jobs + one-shot `runJob`) |
| Frontend | Devvit Block Kit (React-like JSX with `useState`, `useAsync`, `useInterval`, `useForm`) |

---

## Common Commands

```bash
npm run build          # compile TypeScript → dist/
devvit upload          # upload app version to Reddit
devvit playtest r/sub  # hot-reload dev mode against a live subreddit
npm test               # run Jest test suite
npm run test:watch     # watch mode
```

---

## Architecture

```
New Post Submitted
      │
      ▼
[PostSubmit Trigger]           [Cron Job: every 2 min]
Immediate analysis              Batch queue processor
      │                                │
      ▼                                ▼
┌──────────────────────────────────────────────────┐
│          Two-Tier Classification Pipeline         │
│                                                  │
│  1. Batch embed all posts (1 API call)           │
│  2. Cosine search → closest policy match         │
│  3. Similarity routing:                          │
│     sim < 0.45  → auto-approve (embedding only) │
│     sim ≥ 0.85  → auto-flag   (embedding only) │
│     0.45–0.85 or reported → LLM classify        │
│  4. Save Recommendation + ModItem to KV          │
└──────────────────────────────────────────────────┘
      │
      ▼
KV Store
  ├── mod_item_index / mod_item:<id>
  ├── recommendation_index / recommendation:<id>
  ├── history (actioned items — never purged)
  ├── embedding:<id>
  ├── policy_index / policy:<id>
  ├── insight_index / insight:<id>
  └── mod_decision_index / mod_decision:<id>
      │
      ▼
Dashboard (Custom Post — polls KV every 15s)
  ├── Triage view     — one-at-a-time item review
  ├── History view    — paginated action log with AND-logic filters
  ├── Insights view   — consistency analytics
  └── Settings view   — AI config, fullscreen toggle
```

---

## Key Source Files

| File | Role |
|---|---|
| `devvit.json` | Devvit Web app configuration: web view, server, triggers, menu items, scheduler |
| `src/main.ts` | App settings declarations |
| `src/server/index.ts` | Express endpoints for dashboard API, menu actions, triggers, and scheduler jobs |
| `src/client/index.html` | Devvit Web dashboard client |
| `src/jobs/queue-processor.ts` | Batch queue analysis (embed → cosine → LLM → save recommendation) |
| `src/policy/llm-classifier.ts` | LLM classification with structured JSON output; handles structural AND factual rules |
| `src/policy/rule-ingestor.ts` | Ingests subreddit rules (title + description → PolicyObject) |
| `src/queue/fetcher.ts` | Fetches mod queue (reported + spam + unmoderated, 7-day filter on unmoderated) |
| `src/shared/dashboard-helpers.ts` | Shared dashboard sorting and formatting helpers |
| `src/consistency/engine.ts` | Consistency analytics (requires ≥ 50 mod decisions) |
| `src/storage/recommendation-store.ts` | Recommendation CRUD + purge logic (preserves history) |
| `src/storage/mod-decision-store.ts` | ModDecision log (written on every Remove/Approve action) |
| `src/storage/keys.ts` | Central KV key definitions |

---

## Hard Constraints

- **Always execute Reddit API actions** — Remove/Approve from the dashboard immediately calls `reddit.remove()` / `reddit.approve()`. There is no deferred "mark only" mode. The old `directActionsEnabled` toggle has been removed.
- **Always show confidence scores and reasoning traces.** No black-box AI decisions.
- **History is permanent** — `purgeStaleRecommendations` never deletes items with `actionedAt` or `autoActed=true`. They are preserved as the permanent moderation log.
- **Frame consistency insights as operational analytics**, never as moderator blame or bias detection.
- **Store minimally** — avoid raw long-term content storage and unnecessary personal data.

---

## Devvit Platform Constraints (Critical)

### Execution Timeouts
- **UI action handlers have a hard 3-second timeout.** Any operation involving AI calls, network requests, or heavy KV reads MUST be delegated to `scheduler.runJob()`.
- Never run `runQueueProcessor` or `runConsistencyEngine` inline in a menu item handler or button `onPress`.
- ✅ Correct: `await scheduler.runJob({ name: 'queue-processor', runAt: new Date() })`
- ❌ Wrong: `await runQueueProcessor(...)` inside a menu `onPress`

### useState
- `useState<T>` requires `T extends JSONValue`. For complex domain types (arrays of interfaces), omit the generic and use `any` with a cast: `const [data, setData] = useState<any>(null)`.
- **No functional updater pattern** — `setState((prev) => next)` is silently ignored. Always use the current value from state directly: `setState(currentValue - 1)`.
- All hooks must be called at the root component level — no conditional hook calls.

### useInterval
- Callback must be synchronous-safe (async callbacks are fine but errors are swallowed).
- Call `.start()` and `.stop()` on the returned handle.
- Use for polling (15s KV reload) and countdown timers (1s tick).

### Scroll
- **Devvit custom posts have no scroll container.** Fixed height, content that overflows is clipped. Scroll events bubble to the Reddit page.
- Use pagination instead. Keep total item count per page ≤ 3 for the ~480px post height.

### JSX / Block Kit
- Use `.tsx` extension — required for JSX syntax.
- Import `Devvit` from `@devvit/public-api` in every `.tsx` file — it is the JSX factory.
- `gap="xsmall"` is **not** a valid `ContainerGap` — minimum is `gap="small"`.
- Conditional JSX that could return `undefined` causes a type error. Pre-render to a variable: `const el = condition ? <X /> : <Y />`.
- `map()` inside JSX: Devvit does not support a `key` prop — omit it.
- `backgroundColor` values must be 8-digit hex with alpha: `"#09090bFF"` not `"#09090b"`.

### useAsync
- `useAsync<T>` requires `T extends JSONValue`. For complex types, omit generic and cast after.
- `finally` callback signature: `(data: T | null, error: AsyncError | null) => void` (two params).

---

## Coding Patterns

### Adding a new AI provider

1. Create `src/ai/<name>.ts` implementing `EmbeddingClient` and `TextGenerationClient` from `src/ai/types.ts`
2. Add a case in `createAIProvider` in `src/ai/provider.ts`
3. Add `Devvit.addSettings` entries in `src/main.ts` (API key as secret, config as non-secret)
4. Match the `AI_PROVIDER` setting string to the factory case name

### Adding a new storage key

1. Add to `KEYS` in `src/storage/keys.ts`
2. Static keys: `snake_case` strings. Dynamic keys: arrow functions returning `'prefix:id'`
3. Create a store file in `src/storage/` with `save*`, `get*`, `list*` functions — always `(kv: KVStore, ...)` as first argument
4. Index pattern: store a list of IDs under a `*_index` key for enumeration

### Adding a new menu item

1. Add the item to `devvit.json` under `menu.items` with an `/internal/menu/...` endpoint
2. Implement the endpoint in `src/server/index.ts`
3. Always guard with `if (!context.subredditName)` before using `subredditName`
4. For any operation taking more than 1 second, schedule a job instead of running inline
5. Return a Devvit Web `UiResponse`, such as `{ showToast: 'Started' }`

### Adding a new dashboard view

1. Add the tab and renderer in `src/client/index.html`
2. Expose any required data through `/api/dashboard` or a new `/api/...` endpoint in `src/server/index.ts`
3. Keep server-only capabilities in the server; the web view should call them with `fetch()`
4. Keep the view within the configured post height and avoid layout shift

### Classification pipeline (queue-processor)

The skip logic follows strict priority rules:
1. `existingRec?.actionedAt` → permanently skip (silent, no log)
2. Non-approve verdict fresh since last edit → skip (log)
3. Approve verdict < 24h old → skip (silent)
4. Otherwise → add to `toProcess` batch

The analysis function `analyseItemWithVector`:
- `sim < 0.45` → embedding-only approve (no LLM call)
- `sim >= 0.85` → embedding-only flag (no LLM call)
- `0.45 <= sim < 0.85` OR `isReported` → call LLM

### LLM classifier prompt

Two rule categories require different reasoning strategies in `SYSTEM_PROMPT`:
- **Structural rules** ("no titles starting with A") → literal text inspection
- **Factual accuracy rules** ("no misinformation") → LLM uses world knowledge to verify truth

The prompt includes worked examples to anchor factual reasoning. When modifying the prompt, preserve both sections and the worked examples.

### Rule ingestion

`rule-ingestor.ts` stores:
- `text`: combined `"${title}\n\nDescription: ${description}"` (or title alone if no description)
- `metadata.description`: raw description for classifier's rules block

Always run **AMIS: Refresh Policy** after changing rule ingestion logic to re-embed with the new format.

---

## Shipped Features (v0.0.10)

- ✅ Real-time PostSubmit trigger with configurable auto-remove threshold
- ✅ Two-tier classification (embedding pre-filter + conditional LLM)
- ✅ 24-hour approve verdict cache (Rule 3 in queue-processor)
- ✅ 7-day staleness filter on unmoderated posts
- ✅ Always-execute Reddit API actions (removed `directActionsEnabled` toggle)
- ✅ ModDecision written to KV on every action (consistency engine input)
- ✅ Auto-polling dashboard (15s `useInterval`)
- ✅ Live countdown banner during background jobs
- ✅ History view with AND-logic filter chips (3 items/page, pagination)
- ✅ Background jobs for all long-running menu actions (no timeout)
- ✅ Factual accuracy LLM prompt with worked examples
- ✅ Rule ingestion includes title + description
- ✅ Permanent moderation history (actioned items never purged)
- ✅ Multi-provider AI (OpenAI, Gemini, Claude, custom/local)
